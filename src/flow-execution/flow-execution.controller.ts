import { Controller, Post, Get, Query, Body, Req, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { CrmFlowExecutionService } from './crm-flow-execution.service';

@Controller('flow-execution')
export class FlowExecutionController {
  // Simple in-memory rate limiter to prevent spam execution tests
  private readonly rateLimits = new Map<string, { count: number; resetTime: number }>();

  constructor(private readonly crmFlowExecutionService: CrmFlowExecutionService) {}

  private checkRateLimit(key: string) {
    const now = Date.now();
    const limitInfo = this.rateLimits.get(key);

    if (!limitInfo || now > limitInfo.resetTime) {
      this.rateLimits.set(key, { count: 1, resetTime: now + 60000 });
      return;
    }

    if (limitInfo.count >= 5) { // Max 5 requests per minute for testing
      throw new HttpException('Too Many Requests: Test execution limit exceeded (max 5 req/min)', HttpStatus.TOO_MANY_REQUESTS);
    }

    limitInfo.count++;
  }

  @Post('test-action')
  async testAction(
    @Body() body: { nodeData: any; testVariables?: any },
    @Req() req: any
  ) {
    const projectId = req.user?.projectId || req.user?.adminId || req.body?.projectId || body.nodeData?.projectId || 'test_project';
    if (!projectId) throw new UnauthorizedException('Project ID missing');

    const rateLimitKey = `${projectId}_${req.ip}`;
    this.checkRateLimit(rateLimitKey);

    try {
      const result = await this.crmFlowExecutionService.testSingleAction(
        body.nodeData,
        projectId,
        body.testVariables || {}
      );
      return { success: true, data: result };
    } catch (error: any) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  @Get('history')
  async getHistory(
    @Req() req: any,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('type') type?: string
  ) {
    const projectId = req.user?.projectId || req.user?.adminId || req.query?.projectId || 'test_project';
    if (!projectId) throw new UnauthorizedException('Project ID missing');

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;

    try {
      return await this.crmFlowExecutionService.getExecutionLogs(projectId, limitNum, pageNum, type);
    } catch (error: any) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
