import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ZoomMeeting, ZoomMeetingDocument } from './zoom-meeting.schema';
import { Model, Types } from 'mongoose';
import { ZoomService } from '../zoom.service';

@Injectable()
export class ZoomMeetingService {
  constructor(
    @InjectModel(ZoomMeeting.name)
    private zoomMeetingModel: Model<ZoomMeetingDocument>,
    @Inject(forwardRef(() => ZoomService))
    private readonly zoomService: ZoomService,
  ) {}

  async syncZoomMeetingData(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
  ): Promise<void> {
    const meetingData = await this.zoomService.getMeetingDetails(
      adminId,
      projectId,
      meetingId,
    );

    if (meetingData) {
      await this.zoomMeetingModel.findOneAndUpdate(
        { id: String(meetingData.id) },
        {
          id: String(meetingData.id),
          topic: meetingData.topic,
          duration: meetingData.duration,
          start_time: meetingData.start_time,
          join_url: meetingData.join_url,
          timezone: meetingData.timezone,
          status: meetingData.status,
          occurrences: meetingData.occurrences?.map((occurrence) => ({
            start_time: occurrence.start_time,
            occurrence_id: occurrence.occurrence_id,
            status: occurrence.status,
            duration: occurrence.duration,
            raw: occurrence,
          })),
          raw: meetingData,
        },
        { upsert: true, new: true },
      );
    }
  }

  async getZoomMeeting(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
  ): Promise<ZoomMeeting> {
    await this.syncZoomMeetingData(adminId, projectId, meetingId);

    return this.zoomMeetingModel
      .findOne({
        id: meetingId,
      })
      .lean();
  }

  async getZoomMeetingByMeetingId(
    meetingId: string,
  ): Promise<ZoomMeeting | null> {
    return this.zoomMeetingModel
      .findOne({
        id: meetingId,
      })
      .lean();
  }

  async syncZoomWebinarData(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    webinarId: string,
  ): Promise<void> {
    const webinarData = await this.zoomService.getWebinarDetails(
      adminId,
      projectId,
      webinarId,
    );

    if (webinarData) {
      await this.zoomMeetingModel.findOneAndUpdate(
        { id: String(webinarData.id) },
        {
          id: String(webinarData.id),
          topic: webinarData.topic,
          duration: webinarData.duration,
          start_time: webinarData.start_time,
          join_url: webinarData.join_url,
          timezone: webinarData.timezone,
          status: webinarData.status,
          occurrences: webinarData.occurrences?.map((occurrence) => ({
            start_time: occurrence.start_time,
            occurrence_id: occurrence.occurrence_id,
            status: occurrence.status,
            duration: occurrence.duration,
            raw: occurrence,
          })),
          raw: webinarData,
        },
        { upsert: true, new: true },
      );
    }
  }

  async getZoomWebinar(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    webinarId: string,
  ): Promise<ZoomMeeting> {
    await this.syncZoomWebinarData(adminId, projectId, webinarId);

    return this.zoomMeetingModel
      .findOne({
        id: webinarId,
      })
      .lean();
  }
}
