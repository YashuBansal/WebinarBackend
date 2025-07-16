import { Injectable } from '@nestjs/common';
import { User } from '../schemas/User.schema';

import * as speakeasy from 'speakeasy';

@Injectable()
export class TwoFactorAuthenticationService {
  

  public generateTwoFactorAuthenticationSecret(user: User) {
    const secret = speakeasy.generateSecret({
      name: `YourAppName (${user.email})`,
    });

    return {
      secret: secret.base32,
    };
  }

  public isTwoFactorAuthenticationCodeValid(
    twoFactorAuthenticationCode: string,
    user: User,
  ) {
    return speakeasy.totp.verify({
      secret: user.twoFactorAuthenticationSecret,
      encoding: 'base32',
      token: twoFactorAuthenticationCode,
    });
  }
}