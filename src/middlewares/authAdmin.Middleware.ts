import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Response } from 'express';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthAdminTokenMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userService: UsersService,
  ) {}

  async use(req, res: Response, next: NextFunction) {
    const queryAccessToken = req?.query?.accessToken;
    const access_token =
      req.cookies[this.configService.get('ACCESS_TOKEN_NAME')];
    const pabbly_access_token = this.extractTokenFromHeader(req);

    if (!access_token && !pabbly_access_token && !queryAccessToken) {
      console.error('Auth Admin User -> Access Token not found');
      throw new UnauthorizedException('Access token not found.');
    }

    if (
      pabbly_access_token &&
      this.userService.expiredPablyTokens.has(pabbly_access_token)
    ) {
      throw new UnauthorizedException('Pably token has expired.');
    }

    try {
      if (queryAccessToken) {
        const decodeOptions = {
          secret: this.configService.get('PABBLY_CLIENT_ACCESS_TOKEN_SECRET'),
        };

        const decodedToken = this.jwtService.verify(
          queryAccessToken,
          decodeOptions,
        );

        if (this.userService.expiredPablyTokens.has(queryAccessToken)) {
          throw new UnauthorizedException(
            'Unauthorized, Invalid API access token.',
          );
        }

        if (
          decodedToken &&
          decodedToken.role === this.configService.get('appRoles').ADMIN
        ) {
          req.id = decodedToken.id;
          req.role = decodedToken.role;
          req.plan = decodedToken.plan;
          next();
        } else {
          throw new UnauthorizedException(
            'Unauthorized, Invalid Pabbly access token.',
          );
        }
      } else if (pabbly_access_token) {
        const decodeOptions = {
          secret: this.configService.get('PABBLY_CLIENT_ACCESS_TOKEN_SECRET'),
        };

        const decodedToken = this.jwtService.verify(
          pabbly_access_token,
          decodeOptions,
        );

        if (
          decodedToken &&
          decodedToken.role === this.configService.get('appRoles').ADMIN
        ) {
          req.id = decodedToken.id;
          req.role = decodedToken.role;
          req.plan = decodedToken.plan;
          next();
        } else {
          throw new UnauthorizedException(
            'Unauthorized, Invalid API access token.',
          );
        }
      } else if (access_token) {
        const decodeOptions = {
          secret: this.configService.get('ACCESS_TOKEN_SECRET'),
        };

        const decodedToken = this.jwtService.verify(
          access_token,
          decodeOptions,
        );

        if (
          decodedToken &&
          [
            this.configService.get('appRoles').ADMIN,
            this.configService.get('appRoles').SUPER_ADMIN,
          ].includes(decodedToken.role)
        ) {
          req.id = decodedToken.id;
          req.role = decodedToken.role;
          req.plan = decodedToken.plan;
          next();
        } else {
          throw new UnauthorizedException('Unauthorized access token.');
        }
      }
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private extractTokenFromHeader(req): string | undefined {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
