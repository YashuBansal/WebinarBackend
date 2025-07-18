import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signIn.dto';
import { CookieOptions, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { CreateEmployeeDto } from './dto/createEmployee.dto';
import { AdminId, Id, Plan, Role } from 'src/decorators/custom.decorator';
import { CreateClientDto, ValidateOtpDto } from './dto/createClient.dto';
import { GeneratePablyTokenDto } from './dto/generatePablyToken.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

   private getCookieOptions(): CookieOptions {
    const isProduction = this.configService.get('NODE_ENV') !== 'development';
    const cookieDomain = this.configService.get('COOKIE_DOMAIN');

    return {
      httpOnly: true, // Prevents client-side JS from accessing the cookie
      secure: isProduction, // Only send cookie over HTTPS in production
      sameSite: 'lax', // 'lax' is a good default. Use 'strict' if you are sure your FE/BE are on the same site. Use 'none' for completely different domains (requires secure: true)
      path: '/', // Cookie is available to all paths
      // domain: isProduction ? cookieDomain : undefined, // Share cookie across subdomains in production
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days. Match this to your JWT expiration if possible.
    };
  }

  @Post('login')
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.signIn(signInDto);

    if(result.twoFA){
      return {
        twoFa: true
      }
    }

    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getCookieOptions()
      );
    }
    return result.userData;
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(this.configService.get('ACCESS_TOKEN_NAME')); // Unset the access token cookie
    return { message: 'Successfully logged out' };
  }

  @Post('refresh')
  async refreshToken(
    @Body() body: { email: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refreshToken(body.email);
    console.log(this.configService.get('NODE_ENV') !== 'development', "--- log ---", this.configService.get('NODE_ENV'))
    if (result.access_token) {
      response.cookie(
        this.configService.get('ACCESS_TOKEN_NAME'),
        result.access_token,
        this.getCookieOptions()
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
  async getCurrentUser(
    @Id() id: string,
  ): Promise<any> {

    const user = await this.authService.getCurrentUser(id);

    return {
      status: true,
      message: 'User found',
      data: user
    }

  }

  // @Get('/token/:id')
  // async pabblyToken(
  //   @Param() param
  // ): Promise<any> {
  //   return this.authService.pabblyToken(param.id)
  // }

  @Post('forgot-password/:email')
  async generateOTP( @Param('email') email: string ) {
    return this.authService.generateOtp(email);
  } 

  @Post('validate-otp')
  async validateOTP(@Body() validateOtpDto: ValidateOtpDto) {
    await this.authService.validateOTP(validateOtpDto.email, validateOtpDto.otp);
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
    const result = await this.authService.pablyToken(id, generatePablyTokenDto.expiry);
    return {
      token: result.pabblyToken,
      pabblyTokenExpiry: result.pabblyTokenExpiry,
    };
  }
}
