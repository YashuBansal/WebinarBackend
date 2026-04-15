import { Injectable, NotAcceptableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { Alarm } from 'src/schemas/Alarm.schema';
import { Assignments } from 'src/schemas/Assignments.schema';
import { AttendeeAssociation } from '../attendee-association/attendee-association.schema';
import { Attendee } from 'src/schemas/Attendee.schema';
import { BillingHistory } from 'src/schemas/BillingHistory.schema';
import { CustomLeadType } from 'src/schemas/custom-lead-type.schema';
import { Enrollment } from 'src/schemas/Enrollments.schema';
import { FilterPreset } from 'src/schemas/FilterPreset.schema';
import { Location } from 'src/schemas/location.schema';
import { Notes } from 'src/schemas/Notes.schema';
import { NoticeBoard } from 'src/schemas/notice-board.schema';
import { Notification } from 'src/schemas/notification.schema';
import { Plans } from 'src/schemas/Plans.schema';
import { Products } from 'src/schemas/Products.schema';
import { StatusDropdown } from 'src/schemas/StatusDropdown.schema';
import { User } from 'src/schemas/User.schema';
import { UserActivity } from 'src/schemas/UserActivity.schema';
import { Webinar } from 'src/schemas/Webinar.schema';
import { ProductLevel } from 'src/schemas/product-level.schema';
import { SubscriptionAddOn } from 'src/schemas/SubscriptionAddon.schema';
import { Tag } from 'src/schemas/tags.schema';
import { UserDocuments } from 'src/schemas/user-documents.schema';
import { ApiAccessToken } from 'src/schemas/api-token.schema';
import { AttendeeLog } from 'src/schemas/attendee-logs.schema';
import { Subscription } from 'src/schemas/Subscription.schema';
import { WebinarParticipant } from 'src/schemas/webinar-participant.schema';
@Injectable()
export class DeleteDataService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Webinar.name) private readonly webinarModel: Model<Webinar>,
    @InjectModel(Notes.name) private readonly notesModel: Model<Notes>,
    @InjectModel(Attendee.name) private readonly attendeeModel: Model<Attendee>,
    @InjectModel(AttendeeAssociation.name)
    private readonly attendeeAssociationModel: Model<AttendeeAssociation>,
    @InjectModel(BillingHistory.name)
    private readonly billingHistoryModel: Model<BillingHistory>,
    @InjectModel(CustomLeadType.name)
    private readonly customLeadTypeModel: Model<CustomLeadType>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Products.name) private readonly productsModel: Model<Products>,
    @InjectModel(StatusDropdown.name)
    private readonly statusDropdownModel: Model<StatusDropdown>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,

    @InjectModel(Alarm.name) private readonly alarmModel: Model<Alarm>,
    @InjectModel(NoticeBoard.name)
    private readonly noticeBoardModel: Model<NoticeBoard>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(UserActivity.name)
    private readonly userActivityModel: Model<UserActivity>,
    @InjectModel(FilterPreset.name)
    private readonly filterPresetModel: Model<FilterPreset>,
    @InjectModel(Assignments.name)
    private readonly assignmentsModel: Model<Assignments>,
    @InjectModel(Location.name) private readonly locationModel: Model<Location>,
    @InjectModel(ProductLevel.name)
    private readonly productLevelModel: Model<ProductLevel>,
    @InjectModel(SubscriptionAddOn.name)
    private readonly subscriptionAddOnModel: Model<SubscriptionAddOn>,
    @InjectModel(Tag.name) private readonly tagModel: Model<Tag>,
    @InjectModel(UserDocuments.name)
    private readonly userDocumentsModel: Model<UserDocuments>,
    @InjectModel(Plans.name) private readonly plansModel: Model<Plans>,
    @InjectModel(ApiAccessToken.name)
    private readonly accessTokenModel: Model<ApiAccessToken>,
    @InjectModel(AttendeeLog.name)
    private readonly attendeeLogModel: Model<AttendeeLog>,
    @InjectModel(WebinarParticipant.name)
    private readonly webinarparticipantModel: Model<WebinarParticipant>,
  ) {}

  //   async deleteData(id: string): Promise<any> {
  //     try {
  //       // Delete all data except for User and StatusDropdown where adminId equals the provided id
  //       // await Promise.all([
  //       //     // Delete all records in the following models
  //       //     this.webinarModel.deleteMany({}),
  //       //     this.notesModel.deleteMany({}),
  //       //     this.attendeeModel.deleteMany({}),
  //       //     this.attendeeAssociationModel.deleteMany({}),
  //       //     this.billingHistoryModel.deleteMany({}),
  //       //     this.customLeadTypeModel.deleteMany({}),
  //       //     this.enrollmentModel.deleteMany({}),
  //       //     this.productsModel.deleteMany({}),
  //       //     this.subscriptionModel.deleteMany({}),
  //       //     this.alarmModel.deleteMany({}),
  //       //     this.noticeBoardModel.deleteMany({}),
  //       //     this.notificationModel.deleteMany({}),
  //       //     this.userActivityModel.deleteMany({}),
  //       //     this.filterPresetModel.deleteMany({}),
  //       //     this.assignmentsModel.deleteMany({}),
  //       //     this.locationModel.deleteMany({}),
  //       //     this.productLevelModel.deleteMany({}),
  //       //     this.subscriptionAddOnModel.deleteMany({}),
  //       //     this.tagModel.deleteMany({}),
  //       //     this.userDocumentsModel.deleteMany({}),
  //       //     this.plansModel.deleteMany({}),
  //       //     // Delete records in User and StatusDropdown but exclude those with adminId equal to provided id
  //       //     this.userModel.deleteMany({ _id: { $ne: new Types.ObjectId(`${id}`) } }), // Do not delete users with adminId == id
  //       //     // this.statusDropdownModel.deleteMany({ createdBy: { $ne: id } }) // Do not delete StatusDropdown with adminId == id
  //       // ]);

  //       return {
  //         success: true,
  //         message: 'All data has been deleted from all models.',
  //       };
  //     } catch (error) {
  //       console.error('Error deleting data:', error);
  //       throw new Error('An error occurred while deleting data from the models.');
  //     }
  //   }

  async deleteDataByAdminId(adminId: Types.ObjectId) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin Id');
    }

    await this.alarmModel.deleteMany({
      adminId: adminId,
    });

    await this.accessTokenModel.deleteMany({
      user: adminId,
    });

    await this.assignmentsModel.deleteMany({
      adminId: adminId,
    });

    await this.attendeeAssociationModel.deleteMany({
      adminId: adminId,
    });

    await this.attendeeLogModel.deleteMany({
      adminId: adminId,
    });

    await this.attendeeModel.deleteMany({
      adminId: adminId,
    });

    await this.billingHistoryModel.deleteMany({
      admin: adminId,
    });

    await this.billingHistoryModel.deleteMany({
      admin: adminId,
    });

    await this.customLeadTypeModel.deleteMany({
      createdBy: adminId,
    });

    await this.enrollmentModel.deleteMany({
      adminId: adminId,
    });

    await this.notesModel.deleteMany({
      adminId: adminId,
    });

    await this.filterPresetModel.deleteMany({
      userId: `${adminId}`,
    });

    await this.noticeBoardModel.deleteMany({
      adminId: adminId,
    });

    await this.notificationModel.deleteMany({
      recipient: adminId,
    });

    await this.productLevelModel.deleteMany({
      adminId: adminId,
    });

    await this.productsModel.deleteMany({
      adminId: adminId,
    });

    await this.statusDropdownModel.deleteMany({
      createdBy: adminId,
    });

    await this.subscriptionModel.deleteMany({
      admin: adminId,
    });

    await this.tagModel.deleteMany({
      adminId: adminId,
    });

    await this.userActivityModel.deleteMany({
      adminId: adminId,
    });

    await this.userDocumentsModel.deleteMany({
      userId: adminId,
    });

    await this.userModel.deleteMany({
      adminId: adminId,
    });

    await this.userModel.deleteOne({
      _id: adminId,
    });

    await this.webinarparticipantModel.deleteMany({
      adminId: adminId,
    });

    await this.webinarModel.deleteMany({
      adminId: adminId,
    });

    return {
      success: true,
      message: 'All Data Deleted',
    };
  }
}
