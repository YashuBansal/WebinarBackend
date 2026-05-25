import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InterestPoolSettings } from './interest-pool-settings.schema';
import { IntegrationSettings } from '../integrations/integrations.schema';

export interface UpsertInterestPoolSettingsDto {
  accountId: string;
  accessToken: string;
}

@Injectable()
export class InterestPoolSettingsService {
  constructor(
    @InjectModel(InterestPoolSettings.name)
    private readonly settingsModel: Model<InterestPoolSettings>,
    @InjectModel(IntegrationSettings.name)
    private readonly integrationsModel: Model<IntegrationSettings>,
  ) {}

  async getForUser(userId: string) {
    return this.settingsModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
  }

  async upsertForUser(
    userId: string,
    payload: UpsertInterestPoolSettingsDto,
  ): Promise<InterestPoolSettings> {
    const filter = { userId: new Types.ObjectId(userId) };
    const update = {
      accountId: payload.accountId.trim(),
      accessToken: payload.accessToken.trim(),
    };

    const doc = await this.settingsModel
      .findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      })
      .exec();

    // Synchronize to IntegrationSettings
    await this.integrationsModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: {
            'interestPool.accountId': update.accountId,
            'interestPool.accessToken': update.accessToken,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return doc;
  }
}
