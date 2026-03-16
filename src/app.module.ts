import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AttendeesModule } from './attendees/attendees.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import configurations from './config/configurations';
import { GetAdminIdMiddleware } from './middlewares/get-admin-id.middleware';
import { AuthSuperAdminMiddleware } from './middlewares/authSuperAdmin.Middleware';
import { AuthAdminTokenMiddleware } from './middlewares/authAdmin.Middleware';
import { SidebarLinksModule } from './sidebar-links/sidebar-links.module';
import { PlansModule } from './plans/plans.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { BillingHistoryModule } from './billing-history/billing-history.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LandingpageModule } from './landingpage/landingpage.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { UserActivityModule } from './user-activity/user-activity.module';
import { WebinarModule } from './webinar/webinar.module';
import { ExportExcelModule } from './export-excel/export-excel.module';
import { CronModule } from './cron/cron.module';
import { RolesModule } from './roles/roles.module';
import { FilterPresetModule } from './filter-preset/filter-preset.module';
import { NoticeBoardModule } from './notice-board/notice-board.module';
import { AssignmentModule } from './assignment/assignment.module';
import { StatusDropdownModule } from './status-dropdown/status-dropdown.module';
import { DocumentsModule } from './documents/documents.module';
import { AlarmModule } from './alarm/alarm.module';
import { ProductsModule } from './products/products.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { NotesModule } from './notes/notes.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { DeleteDataModule } from './delete-data/delete-data.module';
import { CustomLeadTypeModule } from './custom-lead-type/custom-lead-type.module';
import { AttendeeAssociationModule } from './attendee-association/attendee-association.module';
import { CalendarService } from './calendar/calendar.service';
import { AddonModule } from './addon/addon.module';
import { SubscriptionAddonModule } from './subscription-addon/subscription-addon.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { RazorpayModule } from './razorpay/razorpay.module';
import { NotificationModule } from './notification/notification.module';
import { LocationModule } from './location/location.module';
import { RevenueModule } from './revenue/revenue.module';
import { TagsModule } from './tags/tags.module';
import { ProductRevenueModule } from './product-revenue/product-revenue.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { AttendeeLogModule } from './attendee-log/attendee-log.module';
import { WebsocketModule } from './websocket/websocket.module';
import { WebinarParticipantModule } from './webinar-participant/webinar-participant.module';
import { TwoFactorAuthenticationModule } from './two-factor-authentication/two-factor-authentication.module';
import { ApiAccessTokenModule } from './api-access-token/api-access-token.module';
import { ProjectsModule } from './projects/projects.module';
import { ContactsModule } from './contacts/contacts.module';
import { WabaTagsModule } from './waba-tags/waba-tags.module';
import { WhatsappEmbedModule } from './whatsapp-embed/whatsapp-embed.module';
import { ProfileModule } from './profile/profile.module';
import { FileStorageService } from './file-storage/file-storage.service';
import { ZoomModule } from './zoom/zoom.module';
import { AutomationsModule } from './automations/automations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WebinarAutoMessageModule } from './webinar-auto-message/webinar-auto-message.module';
import { ZoomEventModule } from './zoom/zoom-event/zoom-event.module';
import { ConfiguredTemplatesModule } from './configured-templates/configured-templates.module';
import { MeetingEventConfigModule } from './meeting-event-config/meeting-event-config.module';
import { WinstonModule } from 'nest-winston';
import { WebinarWebhookModule } from './webinar-webhook/webinar-webhook.module';
import { ProgramModule } from './whatsapp-program/program.module';
import { InterestPoolSettingsModule } from './interest-pool-settings/interest-pool-settings.module';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { HealthModule } from './health/health.module';
import { OtelWinstonTransport } from './logger/otel-winston-transport';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configurations],
      isGlobal: true,
    }),
    WinstonModule.forRoot({
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, context }) => {
              return `${timestamp} [${context}] ${level}: ${message}`;
            }),
          ),
        }),
        // Daily rotate file transport for all logs
        new winston.transports.DailyRotateFile({
          filename: 'logs/application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          zippedArchive: true,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
          level: 'info',
        }),
        // Daily rotate file transport for error logs
        new winston.transports.DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          zippedArchive: true,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
          level: 'error',
        }),
        // OpenTelemetry transport - only added if OTEL is configured
        ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SERVICE_NAME
          ? [
              new OtelWinstonTransport({
                serviceName: process.env.OTEL_SERVICE_NAME,
                level: 'info', // Send info level and above to OTEL
              }),
            ]
          : []),
      ],
    }),
    MongooseModule.forRoot(process.env.MONGO_URI),
    ServeStaticModule.forRoot({
      // Use project root so uploads work correctly in both dev (src) and prod (dist)
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        index: false, // don't look for /uploads/index.html
      },
    }),
    AttendeeAssociationModule,
    HealthModule,
    UsersModule,
    AttendeesModule,
    AuthModule,
    SidebarLinksModule,
    PlansModule,
    SubscriptionModule,
    BillingHistoryModule,
    DashboardModule,
    LandingpageModule,
    UserActivityModule,
    WebinarModule,
    ExportExcelModule,
    CronModule,
    RolesModule,
    FilterPresetModule,
    NoticeBoardModule,
    AssignmentModule,
    StatusDropdownModule,
    DocumentsModule,
    AlarmModule,
    ProductsModule,
    MailerModule.forRoot({
      transport: {
        host: 'smtp.hostinger.com',
        port: 465,
        secure: true, // true for 465
        auth: {
          user: process.env.MAILDEV_INCOMING_USER,
          pass: process.env.MAILDEV_INCOMING_PASS,
        },
      },
      defaults: {
        from: 'Webinar Leads Hub <no-reply@webinarleadshub.com>',
      },
    }),

    NotesModule,
    CloudinaryModule,
    EnrollmentsModule,
    DeleteDataModule,
    CustomLeadTypeModule,
    AddonModule,
    SubscriptionAddonModule,
    WhatsappModule,
    RazorpayModule,
    NotificationModule,
    LocationModule,
    RevenueModule,
    TagsModule,
    ProductRevenueModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60,
          limit: 10,
        },
      ],
    }),
    AttendeeLogModule,
    WebsocketModule,
    WebinarParticipantModule,
    TwoFactorAuthenticationModule,
    ApiAccessTokenModule,
    ProjectsModule,
    ContactsModule,
    WabaTagsModule,
    WhatsappEmbedModule,
    ProfileModule,
    ZoomModule,
    AutomationsModule,
    WebhooksModule,
    WebinarAutoMessageModule,
    ZoomEventModule,
    ConfiguredTemplatesModule,
    MeetingEventConfigModule,
    WebinarWebhookModule,
    ProgramModule,
    InterestPoolSettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService, CalendarService, FileStorageService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(GetAdminIdMiddleware)
      .forRoutes({ path: 'users/employee', method: RequestMethod.GET });

    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes({ path: 'auth/employee', method: RequestMethod.POST });

    consumer
      .apply(AuthSuperAdminMiddleware)
      .forRoutes(
        { path: 'users', method: RequestMethod.GET },
        { path: 'users/clients', method: RequestMethod.GET },
        '/documents*',
      );
  }
}