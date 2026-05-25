import { Injectable, BadRequestException, HttpException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { IntegrationSettings } from './integrations.schema';
import { InterestPoolSettings } from '../interest-pool-settings/interest-pool-settings.schema';
import { Attendee } from 'src/schemas/Attendee.schema';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectModel(IntegrationSettings.name)
    private readonly settingsModel: Model<IntegrationSettings>,
    @InjectModel(InterestPoolSettings.name)
    private readonly interestPoolModel: Model<InterestPoolSettings>,
    @InjectModel(Attendee.name)
    private readonly attendeeModel: Model<Attendee>,
  ) { }

  async getForUser(userId: string): Promise<IntegrationSettings> {
    let settings = await this.settingsModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();

    const legacyPool = await this.interestPoolModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();

    if (!settings) {
      // Return a temporary unsaved instance with defaults, seeding from legacy if exists
      const temp = new this.settingsModel({
        userId: new Types.ObjectId(userId),
        convertkit: {
          apiKey: '',
          apiSecret: '',
          isActive: false,
        },
        aweber: { apiKey: '', apiSecret: '', isActive: false },
        activecampaign: { apiKey: '', apiSecret: '', isActive: false },
        pabblyEmail: { apiKey: '', apiSecret: '', isActive: false },
        interestPool: {
          accountId: legacyPool?.accountId || '',
          accessToken: legacyPool?.accessToken || '',
          isActive: !!(legacyPool?.accountId && legacyPool?.accessToken),
        },
      });
      return temp;
    }

    // Seed/sync interestPool from legacy settings if legacy is present but settings lacks them
    if (legacyPool && (!settings.interestPool?.accountId || !settings.interestPool?.accessToken)) {
      settings.interestPool = {
        accountId: settings.interestPool?.accountId || legacyPool.accountId || '',
        accessToken: settings.interestPool?.accessToken || legacyPool.accessToken || '',
        isActive: settings.interestPool?.isActive ?? !!(legacyPool.accountId && legacyPool.accessToken),
      };
    }

    return settings;
  }

  async upsertForUser(
    userId: string,
    payload: Partial<IntegrationSettings>,
  ): Promise<IntegrationSettings> {
    const filter = { userId: new Types.ObjectId(userId) };

    const update: any = {};
    if (payload.convertkit) {
      update.convertkit = {
        apiKey: (payload.convertkit.apiKey || '').trim(),
        apiSecret: (payload.convertkit.apiSecret || '').trim(),
        isActive: Boolean(payload.convertkit.isActive),
      };
    }
    if (payload.aweber) {
      update.aweber = {
        apiKey: (payload.aweber.apiKey || '').trim(),
        apiSecret: (payload.aweber.apiSecret || '').trim(),
        isActive: Boolean(payload.aweber.isActive),
      };
    }
    if (payload.activecampaign) {
      update.activecampaign = {
        apiKey: (payload.activecampaign.apiKey || '').trim(),
        apiSecret: (payload.activecampaign.apiSecret || '').trim(),
        isActive: Boolean(payload.activecampaign.isActive),
      };
    }
    if (payload.pabblyEmail) {
      update.pabblyEmail = {
        apiKey: (payload.pabblyEmail.apiKey || '').trim(),
        apiSecret: (payload.pabblyEmail.apiSecret || '').trim(),
        isActive: Boolean(payload.pabblyEmail.isActive),
      };
    }
    if (payload.interestPool) {
      update.interestPool = {
        accountId: (payload.interestPool.accountId || '').trim(),
        accessToken: (payload.interestPool.accessToken || '').trim(),
        isActive: Boolean(payload.interestPool.isActive),
      };

      // Sync to old InterestPoolSettings schema for backward compatibility
      await this.interestPoolModel
        .findOneAndUpdate(
          { userId: new Types.ObjectId(userId) },
          {
            accountId: update.interestPool.accountId,
            accessToken: update.interestPool.accessToken,
          },
          { upsert: true, new: true },
        )
        .exec();
    }

    const doc = await this.settingsModel
      .findOneAndUpdate(filter, { $set: update }, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      })
      .exec();

    return doc;
  }

  async syncAttendeeToConvertKit(
    adminId: string,
    email: string,
    firstName: string,
    lastName: string,
    webinarName: string,
    eventType: 'registered' | 'attended' | 'high_intent' | 'no_show' | 'buyer_intent',
    timeInSession?: number,
  ) {
    try {
      const settings = await this.settingsModel
        .findOne({ userId: new Types.ObjectId(adminId) })
        .exec();

      if (!settings || !settings.convertkit || !settings.convertkit.isActive) {
        return;
      }

      const { apiKey, apiSecret } = settings.convertkit;
      if (!apiSecret && !apiKey) {
        return;
      }

      const fullName = [firstName, lastName].filter(Boolean).join(' ');

      const fieldsPayload: any = {
        webinar_name: webinarName,
        attendance_status: eventType,
      };
      if (timeInSession !== undefined) {
        fieldsPayload.attendance_duration = String(timeInSession);
      }

      try {
        await axios.post(`https://api.convertkit.com/v3/subscribers`, {
          api_secret: apiSecret || apiKey,
          email,
          first_name: fullName,
          fields: fieldsPayload,
        });
      } catch (err) {
        console.error(`ConvertKit Direct Subscribe Error: ${err.message}`);
      }
    } catch (error) {
      console.error(`syncAttendeeToConvertKit overall error: ${error.message}`);
    }
  }

  async sendDataToIntegration(
    adminId: string,
    integrationKey: 'convertkit' | 'aweber' | 'activecampaign' | 'pabblyEmail',
    attendeeIds: string[],
    webinarId?: string,
    tag?: string,
  ): Promise<{ success: boolean; message: string; count: number }> {
    try {
      const settings = await this.settingsModel
        .findOne({ userId: new Types.ObjectId(adminId) })
        .exec();

      if (!settings) {
        throw new BadRequestException('Integrations settings not configured.');
      }

      const activeConfig = settings[integrationKey];
      if (!activeConfig || !activeConfig.isActive) {
        throw new BadRequestException(`The selected integration "${integrationKey}" is not active or configured.`);
      }

      const { apiKey, apiSecret } = activeConfig as any;
      if (!apiKey && !apiSecret) {
        throw new BadRequestException(`Please configure credentials for ${integrationKey} first.`);
      }

      // Check if IDs look like MongoDB ObjectIds or emails
      const isObjectId = (id: string) => /^[a-f\d]{24}$/i.test(id);

      const objectIds: Types.ObjectId[] = [];
      const emails: string[] = [];

      for (const id of attendeeIds) {
        if (isObjectId(id)) {
          objectIds.push(new Types.ObjectId(id));
        } else if (id && id.includes('@')) {
          emails.push(id.toLowerCase().trim());
        }
      }

      const queryConditions: any[] = [];
      if (objectIds.length > 0) {
        queryConditions.push({ _id: { $in: objectIds } });
      }
      if (emails.length > 0) {
        queryConditions.push({ email: { $in: emails } });
      }

      if (queryConditions.length === 0) {
        throw new BadRequestException('No valid attendee IDs or email addresses provided.');
      }

      const rawAttendees = await this.attendeeModel
        .find({
          $or: queryConditions,
          adminId: new Types.ObjectId(adminId),
        })
        .sort({ createdAt: -1 })
        .populate('webinar')
        .exec();

      if (rawAttendees.length === 0) {
        throw new BadRequestException('No valid attendees found to send.');
      }

      // Deduplicate by email so we only sync the latest record for each contact
      const attendeesMap = new Map<string, typeof rawAttendees[0]>();
      for (const attendee of rawAttendees) {
        const normalizedEmail = attendee.email.toLowerCase().trim();
        if (!attendeesMap.has(normalizedEmail)) {
          attendeesMap.set(normalizedEmail, attendee);
        }
      }

      const attendees = Array.from(attendeesMap.values());

      let successCount = 0;

      for (const attendee of attendees) {
        const webinarName = (attendee.webinar as any)?.webinarName || 'Webinar';
        const fullName = [attendee.firstName, attendee.lastName].filter(Boolean).join(' ');

        if (integrationKey === 'convertkit') {
          try {
            const keyToUse = (apiKey || apiSecret || '').trim();
            const secretToUse = (apiSecret || apiKey || '').trim();

            let success = false;
            let lastError: any = null;
            let subscriberId: string | null = null;

            // 1. Try Kit V4 API first (most modern, direct endpoint)
            try {
              const v4Res = await axios.post('https://api.kit.com/v4/subscribers', {
                email_address: attendee.email,
                first_name: fullName,
                fields: {
                  webinar_name: webinarName,
                  attendance_status: attendee.isAttended ? 'attended' : 'registered',
                  duration: attendee.timeInSession ? String(attendee.timeInSession) : '0',
                }
              }, {
                headers: {
                  'X-Kit-Api-Key': keyToUse,
                  'Content-Type': 'application/json',
                }
              });
              subscriberId = v4Res.data?.subscriber?.id || v4Res.data?.id;
              success = true;
            } catch (v4Err: any) {
              lastError = v4Err;
              // If it failed because of custom fields (422), try subscribing without custom fields
              if (v4Err.response?.status === 422) {
                try {
                  const v4RetryRes = await axios.post('https://api.kit.com/v4/subscribers', {
                    email_address: attendee.email,
                    first_name: fullName,
                  }, {
                    headers: {
                      'X-Kit-Api-Key': keyToUse,
                      'Content-Type': 'application/json',
                    }
                  });
                  subscriberId = v4RetryRes.data?.subscriber?.id || v4RetryRes.data?.id;
                  success = true;
                } catch (v4RetryErr) {
                  lastError = v4RetryErr;
                }
              }
            }

            // V4 Tag association
            if (success && tag && tag.trim()) {
              const tagName = tag.trim();
              try {
                // Fetch tags to see if it exists
                const tagsRes = await axios.get('https://api.kit.com/v4/tags', {
                  headers: { 'X-Kit-Api-Key': keyToUse }
                });
                const foundTag = (tagsRes.data?.tags || []).find(
                  (t: any) => t.name.toLowerCase() === tagName.toLowerCase()
                );

                let tagId = foundTag?.id;

                if (!tagId) {
                  // Create tag
                  const createTagRes = await axios.post('https://api.kit.com/v4/tags', {
                    name: tagName
                  }, {
                    headers: {
                      'X-Kit-Api-Key': keyToUse,
                      'Content-Type': 'application/json',
                    }
                  });
                  tagId = createTagRes.data?.tag?.id || createTagRes.data?.id;
                }

                if (tagId) {
                  // Tag the subscriber
                  await axios.post(`https://api.kit.com/v4/tags/${tagId}/subscribers`, {
                    email_address: attendee.email
                  }, {
                    headers: {
                      'X-Kit-Api-Key': keyToUse,
                      'Content-Type': 'application/json',
                    }
                  });
                }
              } catch (tagErr: any) {
                console.error(`Kit V4 Tagging Error for ${attendee.email}:`, tagErr.response?.data || tagErr.message);
              }
            }

            // 2. If V4 failed, fallback to V3 (Listing forms and subscribing to the first form)
            if (!success) {
              try {
                // Fetch forms using the public API Key
                const formsRes = await axios.get(`https://api.convertkit.com/v3/forms?api_key=${keyToUse}`);
                const forms = formsRes.data?.forms || [];

                if (forms.length > 0) {
                  const formId = forms[0].id;
                  
                  let v3TagId: number | null = null;
                  if (tag && tag.trim()) {
                    const tagName = tag.trim();
                    try {
                      // Fetch V3 tags
                      const tagsRes = await axios.get(`https://api.convertkit.com/v3/tags?api_key=${keyToUse}`);
                      const foundTag = (tagsRes.data?.tags || []).find(
                        (t: any) => t.name.toLowerCase() === tagName.toLowerCase()
                      );

                      if (foundTag) {
                        v3TagId = foundTag.id;
                      } else {
                        // Create Tag
                        const createTagRes = await axios.post('https://api.convertkit.com/v3/tags', {
                          api_secret: secretToUse,
                          tag: { name: tagName }
                        });
                        v3TagId = createTagRes.data?.tag?.id;
                      }
                    } catch (tagErr) {
                      console.error(`Kit V3 Tag Discovery Error:`, tagErr.message);
                    }
                  }

                  try {
                    await axios.post(`https://api.convertkit.com/v3/forms/${formId}/subscribe`, {
                      api_key: keyToUse,
                      api_secret: secretToUse,
                      email: attendee.email,
                      first_name: fullName,
                      tags: v3TagId ? [v3TagId] : undefined,
                      fields: {
                        webinar_name: webinarName,
                        attendance_status: attendee.isAttended ? 'attended' : 'registered',
                        duration: attendee.timeInSession ? String(attendee.timeInSession) : '0',
                      }
                    });
                    success = true;
                  } catch (v3SubscribeErr: any) {
                    lastError = v3SubscribeErr;
                    if (v3SubscribeErr.response?.status === 422) {
                      // Retry without custom fields
                      await axios.post(`https://api.convertkit.com/v3/forms/${formId}/subscribe`, {
                        api_key: keyToUse,
                        api_secret: secretToUse,
                        email: attendee.email,
                        first_name: fullName,
                        tags: v3TagId ? [v3TagId] : undefined,
                      });
                      success = true;
                    }
                  }
                } else {
                  throw new Error('No forms found in your ConvertKit account. Please create at least one form in your ConvertKit dashboard.');
                }
              } catch (v3Err: any) {
                lastError = v3Err;
              }
            }

            if (success) {
              successCount++;
            } else {
              console.error(`ConvertKit Direct Subscribe Error for ${attendee.email}:`, lastError?.response?.data || lastError?.message);
            }
          } catch (err) {
            console.error(`ConvertKit Outer Error for ${attendee.email}:`, err.message);
          }
        } else if (integrationKey === 'aweber') {
          try {
            const credential = (apiKey || apiSecret || '').trim();
            if (credential.startsWith('http')) {
              // Direct Webhook/Custom Endpoint mapping
              await axios.post(credential, {
                email: attendee.email,
                firstName: attendee.firstName,
                lastName: attendee.lastName,
                phone: attendee.phone,
                webinarName,
                attendanceStatus: attendee.isAttended ? 'attended' : 'registered',
                tag: tag || '',
              });
            } else {
              // AWeber API using OAuth2 Bearer Token in credentials
              // 1. Fetch Accounts
              const accountsRes = await axios.get('https://api.aweber.com/1.0/accounts', {
                headers: { Authorization: `Bearer ${credential}` }
              });
              const accounts = accountsRes.data?.entries || [];
              if (accounts.length === 0) {
                throw new Error('No AWeber accounts found.');
              }
              const accountId = accounts[0].id;

              // 2. Fetch Lists for that account
              const listsRes = await axios.get(`https://api.aweber.com/1.0/accounts/${accountId}/lists`, {
                headers: { Authorization: `Bearer ${credential}` }
              });
              const lists = listsRes.data?.entries || [];
              if (lists.length === 0) {
                throw new Error('No mailing lists found in your AWeber account. Please create at least one list.');
              }
              const listId = lists[0].id;

              // 3. Subscribe contact with tags
              try {
                await axios.post(`https://api.aweber.com/1.0/accounts/${accountId}/lists/${listId}/subscribers`, {
                  email: attendee.email,
                  name: fullName || attendee.email,
                  tags: tag && tag.trim() ? [tag.trim()] : undefined,
                }, {
                  headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                  },
                });
              } catch (subErr: any) {
                // If it fails with tags or full details, retry with only email
                await axios.post(`https://api.aweber.com/1.0/accounts/${accountId}/lists/${listId}/subscribers`, {
                  email: attendee.email,
                }, {
                  headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                  },
                });
              }
            }
            successCount++;
          } catch (err: any) {
            console.error(`AWeber Sync Error for ${attendee.email}:`, err.response?.data || err.message);
          }
        } else if (integrationKey === 'activecampaign') {
          try {
            let apiUrl = (apiSecret || '').trim();
            const token = (apiKey || '').trim();

            if (apiUrl && token) {
              if (!apiUrl.startsWith('http')) {
                if (apiUrl.includes('.')) {
                  apiUrl = `https://${apiUrl}`;
                } else {
                  apiUrl = `https://${apiUrl}.api-us1.com`;
                }
              }
              apiUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash

              let contactRes: any;
              try {
                contactRes = await axios.post(`${apiUrl}/api/3/contacts`, {
                  contact: {
                    email: attendee.email,
                    firstName: attendee.firstName || '',
                    lastName: attendee.lastName || '',
                    phone: attendee.phone || '',
                  }
                }, {
                  headers: {
                    'Api-Token': token,
                    'Content-Type': 'application/json',
                  }
                });
              } catch (contactErr: any) {
                // Retry with only email and first name in case of validation failures on phone/last_name
                contactRes = await axios.post(`${apiUrl}/api/3/contacts`, {
                  contact: {
                    email: attendee.email,
                    firstName: attendee.firstName || '',
                  }
                }, {
                  headers: {
                    'Api-Token': token,
                    'Content-Type': 'application/json',
                  }
                });
              }

              const contactId = contactRes.data?.contact?.id;

              if (contactId && tag && tag.trim()) {
                const tagName = tag.trim();
                try {
                  // 1. Search for existing tag
                  const searchRes = await axios.get(`${apiUrl}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                    headers: { 'Api-Token': token }
                  });
                  const foundTag = (searchRes.data?.tags || []).find(
                    (t: any) => t.tag.toLowerCase() === tagName.toLowerCase()
                  );

                  let tagId = foundTag?.id;

                  // 2. Create tag if it doesn't exist
                  if (!tagId) {
                    const createTagRes = await axios.post(`${apiUrl}/api/3/tags`, {
                      tag: {
                        tag: tagName,
                        tagType: 'contact',
                        description: 'Created by Webinar CRM integration'
                      }
                    }, {
                      headers: {
                        'Api-Token': token,
                        'Content-Type': 'application/json',
                      }
                    });
                    tagId = createTagRes.data?.tag?.id;
                  }

                  // 3. Associate tag with contact
                  if (tagId) {
                    await axios.post(`${apiUrl}/api/3/contactTags`, {
                      contactTag: {
                        contact: contactId,
                        tag: tagId
                      }
                    }, {
                      headers: {
                        'Api-Token': token,
                        'Content-Type': 'application/json',
                      }
                    });
                  }
                } catch (tagErr: any) {
                  console.error(`ActiveCampaign Tagging Error for ${attendee.email}:`, tagErr.response?.data || tagErr.message);
                }
              }
            }
            successCount++;
          } catch (err: any) {
            console.error(`ActiveCampaign Sync Error for ${attendee.email}:`, err.response?.data || err.message);
          }
        } else if (integrationKey === 'pabblyEmail') {
          try {
            const credential = (apiKey || apiSecret || '').trim();
            if (credential.startsWith('http')) {
              // Direct Webhook URL (Pabbly Connect, Zapier, Make, etc.)
              await axios.post(credential, {
                email: attendee.email,
                firstName: attendee.firstName,
                lastName: attendee.lastName,
                phone: attendee.phone,
                webinarName,
                attendanceStatus: attendee.isAttended ? 'attended' : 'registered',
                duration: attendee.timeInSession ? String(attendee.timeInSession) : '0',
                tag: tag || '',
              });
            } else {
              // Pabbly Developer API Bearer Token
              // 1. Fetch Subscriber Lists
              const listsRes = await axios.get('https://emails.pabbly.com/api/subscribers-list', {
                headers: {
                  Authorization: `Bearer ${credential}`,
                }
              });
              const lists = listsRes.data?.data || listsRes.data || [];
              if (lists.length === 0) {
                throw new Error('No subscriber lists found in your Pabbly account.');
              }
              const listId = lists[0].list_id || lists[0].id;

              // 2. Import Single Subscriber
              try {
                await axios.post('https://emails.pabbly.com/api/import-subscriber', {
                  list_id: listId,
                  email: attendee.email,
                  first_name: attendee.firstName || '',
                  last_name: attendee.lastName || '',
                }, {
                  headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                  },
                });
              } catch (subErr: any) {
                // Retry with only email if custom details failed
                await axios.post('https://emails.pabbly.com/api/import-subscriber', {
                  list_id: listId,
                  email: attendee.email,
                }, {
                  headers: {
                    Authorization: `Bearer ${credential}`,
                    'Content-Type': 'application/json',
                  },
                });
              }
            }
            successCount++;
          } catch (err: any) {
            console.error(`Pabbly Sync Error for ${attendee.email}:`, err.response?.data || err.message);
          }
        }
      }

      const labelMap = {
        convertkit: 'ConvertKit',
        aweber: 'AWeber',
        activecampaign: 'ActiveCampaign',
        pabblyEmail: 'Pabbly Emails',
      };

      return {
        success: true,
        message: `Successfully sent ${successCount} attendee(s) data to ${labelMap[integrationKey] || integrationKey}.`,
        count: successCount,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }
}
