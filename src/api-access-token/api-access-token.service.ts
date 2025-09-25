import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GeneratePablyTokenDto } from 'src/auth/dto/generatePablyToken.dto';
import { ApiAccessToken } from 'src/schemas/api-token.schema';

@Injectable()
export class ApiAccessTokenService {
  constructor(
    @InjectModel(ApiAccessToken.name)
    private apiTokenModel: Model<ApiAccessToken>,
  ) {}

  async createAccessToken(
    id: Types.ObjectId,
    token: string,
    data: GeneratePablyTokenDto,
  ) {
    const existingToken = await this.apiTokenModel.findOne({
      user: id,
      label: data.label,
      isExpired: false,
      isDeleted: false,
    });

    if (existingToken) {
      throw new BadRequestException('Token already exists with this label');
    }

    if (!token) {
      throw new BadRequestException('API Token is required');
    }

    const payload = {
      user: id,
      label: data.label,
      tokenExpiry: data.expiry,
      token,
    };

    return this.apiTokenModel.create(payload);
  }

  async fetchTokens(id: Types.ObjectId) {
    return this.apiTokenModel.find({
      user: id,
      isDeleted: false,
    });
  }

  async fetchExpiredTokens() {
    return this.apiTokenModel.find({
      isExpired: true,
      isDeleted: false,
    });
  }

  async updateTokenExpiryStatus(
    userId: Types.ObjectId,
    tokenId: Types.ObjectId,
    isExpired: boolean = true,
  ) {
    const token = await this.apiTokenModel.findById({
      _id: tokenId,
      user: userId,
    });
    if (!token) {
      throw new NotFoundException("Token Don't Exists");
    }

    token.isExpired = isExpired;
    return token.save();
  }

  async deleteExpiredTokens() {
    const now = new Date();
    const tokens = await this.apiTokenModel.updateMany(
      {
        tokenExpiry: {
          $lt: now,
        },
        isDeleted: false,
        isExpired: false,
      },
      {
        $set: {
          isDeleted: true,
          isExpired: true,
        },
      },
    );

    console.log('Modified Tokens Count -->', tokens.modifiedCount);
    return tokens;
  }
}
