import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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

  private getCookieOptions(): CookieOptions {
    const isProduction = this.configService.get('NODE_ENV') !== 'development';
    const cookieDomain = this.configService.get('COOKIE_DOMAIN');

    return {
      httpOnly: true, // Prevents client-side JS from accessing the cookie
      secure: true, // Only send cookie over HTTPS in production
      sameSite: 'none',
      maxAge: 3600000 * 5,
    };
  }

  @Post('login')
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.signIn(signInDto);

    if (result.twoFA) {
      return {
        twoFa: true,
      };
    }

    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getCookieOptions(),
      );
    }
    return result.userData;
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    const cookieOptions = this.getCookieOptions();
    const accessTokenName = this.configService.get('ACCESS_TOKEN_NAME');
    response.clearCookie(accessTokenName, {
      ...cookieOptions,
      maxAge: 0, // A common practice to explicitly expire it
    });
    return { message: 'Successfully logged out' };
  }

  @Post('refresh')
  async refreshToken(
    @Body() body: { email: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refreshToken(body.email);
    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getCookieOptions(),
      );
    }

    return {
      status: true,
      message: 'Refresh token generated',
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
