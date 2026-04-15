import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAssociation } from './attendee-association.schema';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AttendeeAssociationService {
  private readonly logger = new Logger(AttendeeAssociationService.name);

  constructor(
    @InjectModel(AttendeeAssociation.name)
    private readonly attendeeAssociationModel: Model<AttendeeAssociation>,
    private readonly attendeeLogService: AttendeeLogService,
    @Inject(forwardRef(() => UsersService))
    private readonly userService: UsersService,
  ) {}

  async createAssociation(
    email: string,
    adminId: Types.ObjectId,
    leadTypeId: Types.ObjectId,
    leadTypeLabel: string,
    createdBy: string,
  ): Promise<AttendeeAssociation> {
    const updatedAssociation =
      await this.attendeeAssociationModel.findOneAndUpdate(
        { email, adminId },
        {
          $set: {
            leadType: new Types.ObjectId(`${leadTypeId}`),
          },
        },
        {
          upsert: true,
          new: true, // return the updated or inserted document
          setDefaultsOnInsert: true, // applies schema defaults on insert
        },
      );

    if (updatedAssociation) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: email,
        item: '',
        action: AttendeeAction.LEAD_TYPE,
        details: `<span>Lead Type Updated by <strong>${createdBy}</strong> : <strong>${leadTypeLabel}</strong>.</span>`,
        adminId: new Types.ObjectId(`${adminId}`),
      });
    }
    return updatedAssociation;
  }

  async createAttendeeLogForTagUpdate(
    email: string,
    adminId: Types.ObjectId,
    id: string,
    tag: string,
    action: 'add' | 'remove',
  ) {
    const user = await this.userService.getUserById(id);
    let userName = '';

    if (user?.userName) {
      userName = user.userName;
    }

    await this.attendeeLogService.createSingleAttendeeLog({
      attendee: email,
      item: '',
      action: AttendeeAction.LEAD_TYPE,
      details: `Tag <strong>${tag}</strong> ${action === 'add' ? 'added' : 'removed'} by <strong>${userName}</strong>`,
      adminId: new Types.ObjectId(`${adminId}`),
    });
  }

  async getAssociation(
    adminId: Types.ObjectId,
    email: string,
  ): Promise<AttendeeAssociation> {
    const association = await this.attendeeAssociationModel
      .findOne({ adminId: new Types.ObjectId(`${adminId}`), email: email })
      .exec();
    return association ? association : null;
  }

  async getAssociationWithLeadType(
    adminId: Types.ObjectId,
    email: string,
  ): Promise<any | null> {
    const association = await this.attendeeAssociationModel
      .findOne({ adminId: new Types.ObjectId(`${adminId}`), email })
      .populate('leadType', 'label')
      .lean()
      .exec();

    return association || null;
  }

  async deleteAttendeeAssociationsByAttendeeEmails(
    session: ClientSession,
    adminId: Types.ObjectId,
    attendees: string[],
  ) {
    return this.attendeeAssociationModel
      .deleteMany({
        adminId: adminId,
        attendee: { $in: attendees },
      })
      .session(session)
      .exec();
  }

  async addFullNamesAndPhonesToAssociation(payload: {
    fullName: string;
    phone: string;
    adminId: Types.ObjectId;
    email: string;
    tags: string[];
  }): Promise<AttendeeAssociation | null> {
    try {
      this.logger.log(
        `addFullNamesAndPhonesToAssociation -> ${JSON.stringify(payload)}`,
      );
      const { fullName = '', phone = '', adminId, email, tags } = payload;

      // Normalize fullName: filter out "undefined" strings and clean up
      let cleanedFullName = '';
      if (fullName) {
        const normalized = fullName
          .trim()
          .replace(/\bundefined\b/gi, '')
          .trim();
        // Only use if it's not empty and not the literal string "undefined"
        if (normalized && normalized !== 'undefined') {
          cleanedFullName = normalized;
        }
      }

      const trimmedPhone = phone?.trim() || '';
      const normalizedTags = Array.isArray(tags)
        ? Array.from(
            new Set(
              tags
                .map((tag) => tag?.toLowerCase().replace(/\s+/g, '').trim())
                .filter((tag): tag is string => Boolean(tag)),
            ),
          )
        : [];

      // Build aggregation pipeline for single atomic upsert operation
      // This approach avoids all MongoDB operator conflicts by using pipeline stages
      const pipeline: any[] = [
        {
          $set: {
            // Ensure required fields are set (for insert case)
            email: email,
            adminId: adminId,
            // fullNames: Filter out "undefined" strings, then merge with new value
            fullNames: {
              $setUnion: [
                {
                  $filter: {
                    input: { $ifNull: ['$fullNames', []] },
                    as: 'name',
                    cond: {
                      $and: [
                        { $ne: ['$$name', null] },
                        { $ne: ['$$name', 'undefined'] },
                        { $ne: [{ $trim: { input: '$$name' } }, ''] },
                      ],
                    },
                  },
                },
                cleanedFullName ? [cleanedFullName] : [],
              ],
            },
            // phones: Merge existing phones with new phone
            phones: {
              $setUnion: [
                { $ifNull: ['$phones', []] },
                trimmedPhone ? [trimmedPhone] : [],
              ],
            },
            // tags: Merge existing tags with new tags
            tags: {
              $setUnion: [
                { $ifNull: ['$tags', []] },
                normalizedTags.length > 0 ? normalizedTags : [],
              ],
            },
          },
        },
      ];

      // Single atomic upsert operation using aggregation pipeline
      const updatedAssociation =
        await this.attendeeAssociationModel.findOneAndUpdate(
          { adminId: adminId, email: email },
          pipeline,
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );

      if (!updatedAssociation) {
        this.logger.error(
          `findOneAndUpdate returned null for email: ${email}, adminId: ${adminId}. This should not happen with upsert: true.`,
        );
        return null;
      }

      return updatedAssociation;
    } catch (error) {
      this.logger.error(
        `Error adding full names, phones, and tags to association for email: ${payload.email}, adminId: ${payload.adminId}. Error message: ${error.message}. Error stack: ${error.stack || 'No stack trace'}`,
      );
      // Log the error details for debugging
      if (error.name) {
        this.logger.error(`Error name: ${error.name}`);
      }
      if (error.code) {
        this.logger.error(`Error code: ${error.code}`);
      }
      return null;
    }
  }

  async bulkUpsertAssociationsTags(
    payload: {
      email: string;
      tags: string[];
    }[],
    adminId: Types.ObjectId,
    session: ClientSession,
  ) {
    if (!session) {
      throw new Error('bulkUpsertAssociationsTags requires an active session.');
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return {
        acknowledged: true,
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        upsertedIds: {},
      };
    }

    const normalizeEmail = (email?: string) =>
      (email ?? '').toLowerCase().trim();

    const normalizeTags = (tags?: string[]) =>
      Array.isArray(tags)
        ? Array.from(
            new Set(
              tags
                .map((tag) =>
                  (tag ?? '')
                    .toString()
                    .toLowerCase()
                    .replace(/\s+/g, '')
                    .trim(),
                )
                .filter((tag): tag is string => Boolean(tag)),
            ),
          )
        : [];

    const preparedPayloadMap = payload.reduce((acc, item) => {
      const email = normalizeEmail(item.email);
      const tags = normalizeTags(item.tags);

      if (!email || tags.length === 0) {
        return acc;
      }

      if (!acc.has(email)) {
        acc.set(email, new Set<string>());
      }

      const tagSet = acc.get(email);
      tags.forEach((tag) => tagSet?.add(tag));

      return acc;
    }, new Map<string, Set<string>>());

    const preparedPayloads = Array.from(preparedPayloadMap.entries()).map(
      ([email, tags]) => ({
        email,
        tags: Array.from(tags),
      }),
    );

    if (preparedPayloads.length === 0) {
      return {
        acknowledged: true,
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        upsertedIds: {},
      };
    }

    const bulkOperations = preparedPayloads.map(({ email, tags }) => ({
      updateOne: {
        filter: { adminId, email },
        update: {
          $setOnInsert: {
            fullNames: [],
            phones: [],
          },
          $addToSet: {
            tags: { $each: tags },
          },
        },
        upsert: true,
      },
    }));

    try {
      return await this.attendeeAssociationModel.bulkWrite(bulkOperations, {
        session,
        ordered: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to bulk upsert association tags for admin ${adminId?.toString()}`,
        error?.stack || error,
      );
      throw error;
    }
  }

  async getInvalidTags(adminId: Types.ObjectId, tags: string[]) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          tags: { $exists: true, $ne: [] },
        },
      },

      { $unwind: '$tags' },

      {
        $match: {
          tags: { $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: null,
          allTagsUsed: { $addToSet: '$tags' },
        },
      },
      {
        $project: {
          _id: 0,
          invalidTags: {
            $setDifference: ['$allTagsUsed', tags],
          },
        },
      },
    ];

    return this.attendeeAssociationModel.aggregate(pipeline);
  }

  async updateAttendeeAssociationTag(
    email: string,
    adminId: Types.ObjectId,
    tag: string,
    action: 'add' | 'remove',
    userId: string,
  ): Promise<AttendeeAssociation | null> {
    try {
      const normalizedTag = tag?.toLowerCase().trim();

      if (!normalizedTag) {
        throw new Error('Tag cannot be empty');
      }

      const association = await this.attendeeAssociationModel.findOne({
        adminId: adminId,
        email: email,
      });

      if (!association) {
        // If association doesn't exist and action is 'add', create it
        if (action === 'add') {
          const newAssociation = await this.attendeeAssociationModel.create({
            email: email,
            adminId: adminId,
            tags: [normalizedTag],
            fullNames: [],
            phones: [],
          });

          await this.createAttendeeLogForTagUpdate(
            email,
            adminId,
            userId,
            normalizedTag,
            action,
          );
          return newAssociation;
        }
        // If action is 'remove' and association doesn't exist, return null
        return null;
      }

      const currentTags = association.tags || [];

      if (action === 'add') {
        // Add tag if it doesn't already exist
        if (!currentTags.includes(normalizedTag)) {
          const updatedTags = [...currentTags, normalizedTag];
          const updatedAssociation =
            await this.attendeeAssociationModel.findByIdAndUpdate(
              association._id,
              {
                $set: {
                  tags: updatedTags,
                },
              },
              { new: true },
            );
          await this.createAttendeeLogForTagUpdate(
            email,
            adminId,
            userId,
            normalizedTag,
            action,
          );
          return updatedAssociation;
        }
        // Tag already exists, return current association
        return association;
      } else if (action === 'remove') {
        // Remove tag if it exists
        const updatedTags = currentTags.filter((t) => t !== normalizedTag);
        const updatedAssociation =
          await this.attendeeAssociationModel.findByIdAndUpdate(
            association._id,
            {
              $set: {
                tags: updatedTags,
              },
            },
            { new: true },
          );
        await this.createAttendeeLogForTagUpdate(
          email,
          adminId,
          userId,
          normalizedTag,
          action,
        );
        return updatedAssociation;
      }

      return association;
    } catch (error) {
      this.logger.error(
        `Error updating attendee association tag for email: ${email}, adminId: ${adminId}, tag: ${tag}, action: ${action}`,
        error.stack || error,
      );
      throw error;
    }
  }
}
