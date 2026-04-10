import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InterestPoolSettings } from './interest-pool-settings.schema';

export interface UpsertInterestPoolSettingsDto {
  accountId: string;
  accessToken: string;
}

@Injectable()
export class InterestPoolSettingsService {
  constructor(
    @InjectModel(InterestPoolSettings.name)
    private readonly settingsModel: Model<InterestPoolSettings>,
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

    return doc;
  }
}
