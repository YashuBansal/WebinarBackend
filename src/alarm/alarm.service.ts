import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CreateAlarmDto, CreateNewAlarmDTO } from './dto/alarm.dto';
import { CronJob } from 'cron';
import { InjectModel } from '@nestjs/mongoose';
import { Alarm } from 'src/schemas/Alarm.schema';
import { ClientSession, Model, Types } from 'mongoose';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { ConfigService } from '@nestjs/config';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
@Injectable()
export class AlarmService {
  constructor(
    @InjectModel(Alarm.name) private readonly alarmsModel: Model<Alarm>,
    private schedulerRegistry: SchedulerRegistry,
    @Inject(forwardRef(() => WebsocketGateway)) // Lazy inject AlarmGateway
    private readonly websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
    private readonly attendeeLogService: AttendeeLogService,
  ) {}

  private readonly logger = new Logger(AlarmService.name);

  async createAlarm(
    data: CreateNewAlarmDTO,
    user: Types.ObjectId,
    adminId: Types.ObjectId,
  ): Promise<Alarm> {
    const existingAlarm = await this.alarmsModel.findOne({
      user: user,
      attendeeId: data.attendeeId,
    });

    if (existingAlarm) {
      throw new NotAcceptableException(
        'An active alarm for this attendee already exists.',
      );
    }

    const alarmDate = new Date(data.date);
    alarmDate.setSeconds(0, 0);
    const now = Date.now();

    if (alarmDate.getTime() <= now) {
      throw new NotAcceptableException(
        'Cannot set an alarm for a time in the past.',
      );
    }

    const reminderDate30min = new Date(alarmDate.getTime() - 30 * 60 * 1000);
    const reminderDate15min = new Date(alarmDate.getTime() - 15 * 60 * 1000);

    const reminders = [];

    if (reminderDate30min.getTime() > now) {
      reminders.push({
        reminderType: '30min',
        reminderDate: reminderDate30min,
        sent: false,
      });
    }

    if (reminderDate15min.getTime() > now) {
      reminders.push({
        reminderType: '15min',
        reminderDate: reminderDate15min,
        sent: false,
      });
    }

    console.log(data)
    const newAlarm = new this.alarmsModel({
      user,
      adminId,
      email: data.email,
      attendeeId: data.attendeeId,
      note: data.note,
      secondaryNumber: data.secondaryNumber,
      attendeePhone: data.attendeePhone,
      date: alarmDate,
      reminders: reminders,
      isActive: true,
    });

    if (adminId && data.createdBy) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: data.email,
        item: '',
        action: AttendeeAction.ALARM,
        details: `<span>Alarm created by <strong>${data.createdBy}</strong> for Date/Time : <strong>${this.formatDateTime(data.date)}</strong>.</span>`,
        adminId,
      });
    }

    this.logger.log(
      `Scheduling alarm for attendee ${data.email} at ${alarmDate.toISOString()}`,
    );

    return newAlarm.save();
  }

  async processDueReminders(): Promise<void> {
    const now = new Date();
    now.setSeconds(0, 0);

    const nextMinute = new Date(now.getTime() + 60 * 1000);

    const alarmsWithDueReminders = await this.alarmsModel
      .find({
        isActive: true,
        reminders: {
          $elemMatch: {
            sent: false,
            reminderDate: { $gte: now, $lt: nextMinute },
          },
        },
      })
      .populate('user');

    if (alarmsWithDueReminders.length === 0) {
      return;
    }

    console.log(alarmsWithDueReminders[0].reminders);

    this.logger.log(
      `Found ${alarmsWithDueReminders.length} alarm(s) with due reminders.`,
    );

    for (const alarm of alarmsWithDueReminders) {
      for (const reminder of alarm.reminders) {
        if (!reminder.sent && reminder.reminderDate <= nextMinute) {
          try {
            this.logger.warn(
              `Sending ${reminder.reminderType} reminder for alarm ${alarm._id}`,
            );
            await this.sendReminderNotification(alarm, reminder.reminderType);

            await this.alarmsModel.updateOne(
              {
                _id: alarm._id,
                'reminders.reminderDate': reminder.reminderDate,
              },
              { $set: { 'reminders.$.sent': true } },
            );
          } catch (error) {
            this.logger.error(
              `Failed to process reminder for alarm ${alarm._id}`,
              error,
            );
          }
        }
      }
    }
  }

  async processDueAlarms(): Promise<void> {
    const now = new Date();
    now.setSeconds(0, 0);
    const nextMinute = new Date(now.getTime() + 60 * 1000);

    // Find alarms due in the next minute that haven't been triggered.
    // This query is highly efficient thanks to the index on `alarmDate`.
    console.log(now, nextMinute);
    const dueAlarms = await this.alarmsModel
      .find({
        date: { $gte: now, $lt: nextMinute },
        isActive: true,
      })
      .populate('user');

    if (dueAlarms.length === 0) {
      return; // Nothing to do
    }

    this.logger.log(`Found ${dueAlarms.length} alarm(s) to trigger.`);

    for (const alarm of dueAlarms) {
      try {
        this.logger.warn(`Triggering main alarm for ${alarm._id}`);
        await this.triggerMainAlarm(alarm);

        // IMPORTANT: Delete the alarm from DB after it has been fully processed.
        await this.alarmsModel.updateOne(
          {
            _id: alarm._id,
          },
          {
            $set: {
              isActive: false,
            },
          },
        );
      } catch (error) {
        this.logger.error(
          `Failed to trigger main alarm for ${alarm._id}`,
          error,
        );
      }
    }
  }

  private async sendReminderNotification(
    alarm: any,
    reminderType: string,
  ): Promise<void> {
    const subscription = await this.getSubscriptionForAlarm(alarm);
    if (!subscription?.plan?.whatsappNotificationOnAlarms) return;

    const msgData = {
      user: {
        phone: alarm.user.phone,
        userName: alarm.user.userName,
        secondaryNumber: alarm.secondaryNumber,
      },
      attendee: {
        email: alarm.email,
        phone: alarm.attendeePhone,
      },
      alarmDate: alarm.date,
      note: alarm.note,
      isReminder: true,
      reminderType,
    };

    if (alarm.user.phone) {
      this.whatsappService.callExternalWebhook(msgData);
    }
  }

  private async triggerMainAlarm(alarm: any): Promise<void> {
    // 1. Send WebSocket notification
    const socketId = this.websocketGateway.activeUsers.get(
      String(alarm.user._id),
    );
    if (socketId) {
      this.websocketGateway.server.to(socketId).emit('playAlarm', {
        message: '!!! Alarm played !!!',
        deleteResult: alarm,
      });
    }

    // 2. Send WhatsApp notification
    const subscription = await this.getSubscriptionForAlarm(alarm);
    if (!subscription?.plan?.whatsappNotificationOnAlarms) return;

    const msgData = {
      user: {
        phone: alarm.user.phone,
        userName: alarm.user.userName,
        secondaryNumber: alarm.secondaryNumber,
      },
      attendee: {
        email: alarm.email,
        phone: alarm.attendeePhone,
      },
      alarmDate: alarm.date,
      note: alarm.note,
      isReminder: false,
    };

    if (alarm.user.phone) {
      await this.whatsappService.callExternalWebhook(msgData);
    }
  }

  private async getSubscriptionForAlarm(alarm: any): Promise<any> {
    const user = alarm?.user;
    if (!user) return null;

    const adminId =
      String(user.role) === this.configService.get('appRoles')['ADMIN']
        ? user._id
        : user.adminId;

    return this.subscriptionService.getSubscription(adminId);
  }

  async setAlarm(
    createAlarmDto: CreateAlarmDto,
    id?: string,
    startup?: boolean,
  ): Promise<any> {
    //perform check here
    const alarmExists = await this.getAttendeeAlarm(
      createAlarmDto.user,
      createAlarmDto.email,
    );

    if (alarmExists && !startup)
      throw new NotAcceptableException(
        'Alarm for this attendee already exists.',
      );

    let reminderAlarmDate = new Date(
      new Date(createAlarmDto.date).getTime() - 900 * 1000,
    );
    let alarmDate = new Date(new Date(createAlarmDto.date).getTime());

    if (alarmDate.getTime() - Date.now() <= 0 && !startup)
      throw new NotAcceptableException('Cannot set alarm for time in past.');

    if (!id) {
      const alarmData = await this.saveAlarmInDB(createAlarmDto);
      id = alarmData._id;
    }

    // reminder alarm
    if (reminderAlarmDate.getTime() - Date.now() > 0) {
      const reminderId = `reminder-${id}`; //format: reminder-{alarm _id from MongoDB}
      const reminderAlarm = new CronJob(reminderAlarmDate, async () => {
        const alarmDetails: any = await this.alarmsModel
          .findById(id)
          .populate('user');

        this.logger.warn(
          `reminder for the alarm was set (${Date.now()}) for job ${reminderId} to run!`,
        );
        const user = alarmDetails?.user;
        let subscription: any = {};
        if (
          String(user?.role) === this.configService.get('appRoles')['ADMIN']
        ) {
          subscription = await this.subscriptionService.getSubscription(
            user?._id,
          );
        } else {
          subscription = await this.subscriptionService.getSubscription(
            user?.adminId,
          );
        }
        console.log('usvcripton', subscription);

        const whatsappNotificationOnAlarms =
          subscription?.plan?.whatsappNotificationOnAlarms;
        console.log('whtsapp', whatsappNotificationOnAlarms);
        const msgData = {
          phone: alarmDetails.user.phone,
          attendeeEmail: alarmDetails.email,
          userName: alarmDetails.user.userName,
          note: alarmDetails.note,
        };
        if (alarmDetails?.user?.phone && whatsappNotificationOnAlarms) {
          this.whatsappService.sendReminderMsg(msgData);
        }
        console.log('setting secondary alarm', createAlarmDto.secondaryNumber);

        if (createAlarmDto.secondaryNumber && whatsappNotificationOnAlarms) {
          this.whatsappService.sendReminderMsg({
            ...msgData,
            phone: createAlarmDto.secondaryNumber,
          });
        }
      });

      this.schedulerRegistry.addCronJob(reminderId, reminderAlarm);
      reminderAlarm.start();

      this.logger.warn(`Alarm ${reminderId} added for ${reminderAlarmDate}!`);
    }

    const alarm = new CronJob(alarmDate, async () => {
      const alarmDetails: any = await this.alarmsModel
        .findById(id)
        .populate('user');
      // console.log(alarmDetails)
      const deleteResult = await this.deleteAlarm(id);
      const socketId = this.websocketGateway.activeUsers.get(
        createAlarmDto.user,
      );
      this.websocketGateway.server.to(socketId).emit('playAlarm', {
        message: '!!! Alarm played !!!',
        deleteResult,
      });
      const user = alarmDetails?.user;
      let subscription: any = {};
      if (String(user?.role) === this.configService.get('appRoles')['ADMIN']) {
        subscription = await this.subscriptionService.getSubscription(
          user?._id,
        );
      } else {
        subscription = await this.subscriptionService.getSubscription(
          user?.adminId,
        );
      }
      console.log('usvcripton', subscription);

      const whatsappNotificationOnAlarms =
        subscription?.plan?.whatsappNotificationOnAlarms;
      console.log('whtsapp', whatsappNotificationOnAlarms);
      if (alarmDetails?.user?.phone && whatsappNotificationOnAlarms) {
        const msgData = {
          phone: alarmDetails.user.phone,
          attendeeEmail: alarmDetails.email,
          userName: alarmDetails.user.userName,
          note: alarmDetails.note,
        };
        await this.whatsappService.sendAlarmMsg(msgData);
      }
    });

    const alarmId = `alarm-${id}`;

    this.schedulerRegistry.addCronJob(alarmId, alarm); //id === alarm document ID in DB
    alarm.start();
    // add alarm data in DB

    this.logger.warn(`Alarm ${alarmId} added for ${alarmDate}!`);
    return 'Alarm set.';
  }

  formatDateTime(isoString: string | Date): string {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) {
        return 'Invalid Date'; // Handle invalid date strings
      }
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');

      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch (error) {
      console.error('Error formatting date:', isoString, error);
      return 'Error'; // Return 'Error' on unexpected format issues
    }
  }

  async saveAlarmInDB(createAlarmDto: CreateAlarmDto): Promise<any> {
    const alarm = await this.alarmsModel.create(createAlarmDto);
    console.log('alarm created', createAlarmDto);
    if (createAlarmDto.adminId && createAlarmDto.createdBy) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: createAlarmDto.email,
        item: '',
        action: AttendeeAction.ALARM,
        details: `<span>Alarm created by <strong>${createAlarmDto.createdBy}</strong> for Date/Time : <strong>${this.formatDateTime(createAlarmDto.date)}</strong>.</span>`,
        adminId: new Types.ObjectId(`${createAlarmDto.adminId}`),
      });
    }

    return alarm;
  }

  async deleteAlarm(id: string): Promise<any> {
    const alarm = await this.alarmsModel.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true },
    );
    return alarm;
  }

  async getAttendeeAlarm(user: string, email: string) {
    const alarm = await this.alarmsModel.findOne({
      user: new Types.ObjectId(`${user}`),
      email: email,
      isActive: true,
    });
    return alarm;
  }

  private checkIfCronJobExists(jobName: string): boolean {
    try {
      const cronJob = this.schedulerRegistry.getCronJob(jobName);
      return !!cronJob; // If the job is found, return true
    } catch (error) {
      return false; // If an error occurs (job not found), return false
    }
  }

  async cancelAlarm(
    alarmId: string,
    id: string,
    createdBy: string,
    adminId: Types.ObjectId,
  ): Promise<any> {
    const alarmData = await this.alarmsModel.findById(alarmId);
    console.log(alarmId, alarmData);

    if (alarmData) {
      const reminderJobName = `reminder-${alarmId}`;
      if (this.checkIfCronJobExists(reminderJobName)) {
        const reminderAlarm =
          this.schedulerRegistry.getCronJob(reminderJobName);
        reminderAlarm.stop();
        console.log('====reminder alarm stopped===');
      }

      const alarmJobName = `alarm-${alarmId}`;
      if (this.checkIfCronJobExists(alarmJobName)) {
        const alarm = this.schedulerRegistry.getCronJob(alarmJobName);
        alarm.stop();
        console.log('====alarm stopped===');
      }
    }
    const deleteAlarm = await this.alarmsModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(`${alarmId}`),
        user: new Types.ObjectId(`${id}`),
      },
      { $set: { isActive: false } },
      { new: true },
    );

    console.log('deleteAlarm', deleteAlarm);
    if (adminId && createdBy && deleteAlarm) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: deleteAlarm.email,
        item: '',
        action: AttendeeAction.ALARM_CANCELLED,
        details: `<span>Alarm cancelled by <strong>${createdBy}</strong> for Date/Time : <strong>${this.formatDateTime(deleteAlarm.date)}</strong>.</span>`,
        adminId: new Types.ObjectId(`${adminId}`),
      });
    }

    return deleteAlarm;
  }

  async fetchUnAckAlarms(userId: string) {
    const alarms = await this.alarmsModel
      .find({
        user: new Types.ObjectId(`${userId}`),
        isAcknowledged: { $ne: true },
        isActive: false,
      })
      .select(
        'date email note _id attendeeId isActive createdAt isAcknowledged',
      )
      .exec();

    return alarms;
  }

  async updateAllAlarmAcknowledgement(user: Types.ObjectId, email: string) {
    console.log(user, email);
    const result = await this.alarmsModel.updateMany(
      {
        user,
        email,
        isAcknowledged: { $ne: true },
        isActive: false,
      },
      {
        $set: {
          isAcknowledged: true,
        },
      },
    );
  }

  async updateAlarmAcknowledgement(alarmId: string) {
    const alarm = await this.alarmsModel.findById(alarmId);
    if (!alarm) throw new NotFoundException('Alarm Not Found');

    alarm.isAcknowledged = true;
    return await alarm.save();
  }

  // async onModuleInit(): Promise<void> {
  //   console.log("===================I'm running bitches===================");
  //   const alarms: any[] = await this.alarmsModel.find({
  //     isActive: true,
  //   });

  //   if (Array.isArray(alarms) && alarms.length > 0) {
  //     alarms.forEach(async (alarm) => {
  //       const createAlarmDto: CreateAlarmDto = {
  //         user: alarm.user,
  //         email: alarm?.email,
  //         attendeeId: alarm?.attendeeId,
  //         date: alarm.date,
  //         note: alarm.note,
  //       };
  //       await this.setAlarm(createAlarmDto, alarm?._id, true);
  //     });
  //   }
  // }

  async fetchAlarmsByMonthAndYear(userId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    const alarms = await this.alarmsModel
      .find({
        user: new Types.ObjectId(`${userId}`),
        date: {
          $gte: startDate,
          $lt: endDate,
        },
      })
      .select(
        'date email note _id attendeeId isActive createdAt isAcknowledged',
      )
      .exec();

    return alarms;
  }

  async deleteAlarmsByAttendeeIds(
    session: ClientSession,
    attendeeIds: Types.ObjectId[],
  ) {
    console.log('alarm -> deleted');
    return this.alarmsModel
      .deleteMany({ attendeeId: { $in: attendeeIds } }, { session })
      .exec();
  }
}
