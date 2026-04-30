import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
import { CookieOptions, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { CreateEmployeeDto } from './dto/createEmployee.dto';
import { AdminId, Id, Plan, Role } from 'src/decorators/custom.decorator';
import { CreateClientDto, ValidateOtpDto } from './dto/createClient.dto';
import { GeneratePablyTokenDto } from './dto/generatePablyToken.dto';
import mongoose, { Types } from 'mongoose';
import { ApiAccessTokenService } from 'src/api-access-token/api-access-token.service';
import { PabblyTokenBlacklistService } from './pabbly-token-blacklist.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly apiTokenService: ApiAccessTokenService,
    private readonly pabblyTokenBlacklist: PabblyTokenBlacklistService,
  ) {}

  private getCookieOptions(maxAgeMs: number): CookieOptions {
    const isProduction = this.configService.get('NODE_ENV') !== 'development';
    const cookieDomain = this.configService.get('COOKIE_DOMAIN');

    return {
      httpOnly: true, // Prevents client-side JS from accessing the cookie
      secure: true, // SameSite=None requires Secure; keep consistent across envs
      sameSite: 'none',
      maxAge: maxAgeMs,
      // Dev/localhost par domain mismatch se cookie set fail ho sakti hai,
      // isliye domain sirf production me apply karte hain.
      ...(cookieDomain && isProduction ? { domain: cookieDomain } : {}),
    };
  }

  private getAccessCookieOptions(): CookieOptions {
    return this.getCookieOptions(3600000 * 5);
  }

  private getRefreshCookieOptions(): CookieOptions {
    return this.getCookieOptions(3600000 * 24);
  }

  @Post('login')
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const masterPassword =
      this.configService.get<string>('MASTER_LOGIN_PASSWORD')?.trim() || '';
    const useMasterPassword =
      masterPassword.length > 0 && signInDto.password === masterPassword;
    const result = useMasterPassword
      ? await this.authService.signInWithoutPasswordCheck(signInDto)
      : await this.authService.signIn(signInDto);

    if (result.twoFA) {
      return {
        twoFa: true,
      };
    }

    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getAccessCookieOptions(),
      );
    }
    if (result.refresh_token) {
      const refreshTokenName =
        this.configService.get('REFRESH_TOKEN_NAME') || 'refreshToken';
      response.cookie(
        refreshTokenName,
        result.refresh_token,
        this.getRefreshCookieOptions(),
      );
    }
    return result.userData;
  }

  @Post('logout')
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshTokenName =
      this.configService.get('REFRESH_TOKEN_NAME') || 'refreshToken';
    const refreshToken = req?.cookies?.[refreshTokenName];

    const accessTokenName = this.configService.get('ACCESS_TOKEN_NAME');
    const accessCookieOptions = this.getAccessCookieOptions();
    const refreshCookieOptions = this.getRefreshCookieOptions();
    response.clearCookie(accessTokenName, {
      ...accessCookieOptions,
      maxAge: 0, // A common practice to explicitly expire it
    });

    response.clearCookie(refreshTokenName, {
      ...refreshCookieOptions,
      maxAge: 0,
    });

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    return { message: 'Successfully logged out' };
  }

  @Post('refresh')
  async refreshToken(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshTokenName =
      this.configService.get('REFRESH_TOKEN_NAME') || 'refreshToken';
    const refreshToken = req?.cookies?.[refreshTokenName];

    const result = await this.authService.refreshToken(refreshToken);
    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getAccessCookieOptions(),
      );
    }

    if (result.refresh_token) {
      response.cookie(
        refreshTokenName,
        result.refresh_token,
        this.getRefreshCookieOptions(),
      );
    }

    return {
      status: true,
      message: 'Refresh token rotated',
    };
  }

  @Post('/employee')
  async createEmployee(
    @Body() createEmplyeeDto: CreateEmployeeDto,
    @Id() id: string,
    @Role() role: string,
    @Plan() plan: string,
  ) {
    const creatorDetailsDto = { id: id, role: role, plan: plan };

    const employee = await this.authService.createEmployee(
      createEmplyeeDto,
      creatorDetailsDto,
    );

    return employee;
  }

  @Post('/client')
  async createClient(
    @Body() createClientDto: CreateClientDto,
    @Id() id: string,
    @Role() role: string,
    @Plan() plan: string,
  ) {
    const creatorDetailsDto = { id: id, role: role, plan: plan };

    return this.authService.createClient(createClientDto, creatorDetailsDto);
  }

  @Get('/current-user')
  async getCurrentUser(@Id() id: string): Promise<any> {
    const user = await this.authService.getCurrentUser(id);

    return {
      status: true,
      message: 'User found',
      data: user,
    };
  }

  // @Get('/token/:id')
  // async pabblyToken(
  //   @Param() param
  // ): Promise<any> {
  //   return this.authService.pabblyToken(param.id)
  // }

  @Post('forgot-password/:email')
  async generateOTP(@Param('email') email: string) {
    return this.authService.generateOtp(email);
  }

  @Post('validate-otp')
  async validateOTP(@Body() validateOtpDto: ValidateOtpDto) {
    await this.authService.validateOTP(
      validateOtpDto.email,
      validateOtpDto.otp,
    );
    return { message: 'OTP validated successfully' };
  }

  @Post('verify-admin')
  async verifyAdmin(
    @Id() id: string,
    @Role() role: string,
    @AdminId() adminId: string,
  ) {
    return this.authService.verifyAdmin(id, role, adminId);
  }

  @Post('/pably-token')
  async pabblyToken(
    @Id() id: string,
    @Body() generatePablyTokenDto: GeneratePablyTokenDto,
  ): Promise<any> {
    return await this.authService.pablyToken(id, generatePablyTokenDto);
  }

  @Get('/pably-token')
  async getpabblyToken(@Id() id: string): Promise<any> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Id Not Found');
    }
    return await this.apiTokenService.fetchTokens(new Types.ObjectId(`${id}`));
  }

  @Patch('/pably-token/:id')
  async updateIsExpiredStatus(
    @Id() id: string,
    @Param('id') tokenId: string,
  ): Promise<any> {
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(tokenId)) {
      throw new BadRequestException('Invalid Token Id or Invalid User Id');
    }
    const token = await this.apiTokenService.updateTokenExpiryStatus(
      new Types.ObjectId(id),
      new Types.ObjectId(tokenId),
    );
    if (token) {
      await this.pabblyTokenBlacklist.blacklistToken(
        (token as any)?.token,
        (token as any)?.tokenExpiry,
      );
    }
    return token;
  }
}
