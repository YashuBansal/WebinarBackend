import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ZoomMeeting, ZoomMeetingDocument } from './zoom-meeting.schema';
import { Model, Types } from 'mongoose';
import { ZoomService } from '../zoom.service';

@Injectable()
export class ZoomMeetingService {
  private readonly logger = new Logger(ZoomMeetingService.name);
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
        { id: String(meetingData.id), projectId },
        {
          id: String(meetingData.id),
          projectId,
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
    // First check if meeting exists in database for this project
    const existingMeeting = await this.getZoomMeetingByMeetingId({
      meetingId,
      zoomProjectId: projectId,
      isWebinar: true,
      retry: false,
      adminId,
    });

    if (existingMeeting) {
      this.logger.debug(
        `Meeting ${meetingId} found in database for project ${projectId}, skipping sync`,
      );
      return existingMeeting;
    }

    // Meeting not found, sync from Zoom API
    this.logger.log(
      `Meeting ${meetingId} not found in database for project ${projectId}, syncing from Zoom API`,
    );
    try {
      await this.syncZoomMeetingData(adminId, projectId, meetingId);
    } catch (error) {
      this.logger.error('Error syncing zoom meeting data', error);
      throw error;
    }

    // Return the synced meeting
    const syncedMeeting = await this.getZoomMeetingByMeetingId({
      meetingId,
      zoomProjectId: projectId,
      isWebinar: false,
      retry: false,
      adminId,
    });
    if (!syncedMeeting) {
      throw new Error(`Failed to retrieve meeting ${meetingId} after sync`);
    }
    return syncedMeeting;
  }

  async getZoomMeetingByMeetingId(payload: {
    meetingId: string;
    zoomProjectId: Types.ObjectId;
    adminId: Types.ObjectId;
    isWebinar: boolean;
    retry: boolean;
  }): Promise<ZoomMeeting | null> {
    try {
      const { meetingId, zoomProjectId, adminId, isWebinar, retry } = payload;
      const zoomMeeting = await this.zoomMeetingModel
        .findOne({
          id: meetingId,
          projectId: zoomProjectId,
        })
        .lean();

      if (zoomMeeting) {
        return zoomMeeting;
      }

      if (retry) {
        this.logger.log(
          `Retrying to sync zoom meeting ${meetingId} for project ${zoomProjectId}`,
        );
        try {
          if (isWebinar) {
            await this.syncZoomWebinarData(adminId, zoomProjectId, meetingId);
          } else {
            await this.syncZoomMeetingData(adminId, zoomProjectId, meetingId);
          }
        } catch (error) {
          this.logger.error(
            `Error syncing zoom ${isWebinar ? 'webinar' : 'meeting'} ${meetingId} for project ${zoomProjectId}`,
            error,
          );
          return null;
        }
      }

      return await this.zoomMeetingModel.findOne({
        id: meetingId,
        projectId: zoomProjectId,
      });
    } catch (error) {
      this.logger.error('Error getting zoom meeting by meeting id', error);
      return null;
    }
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
        { id: String(webinarData.id), projectId },
        {
          id: String(webinarData.id),
          projectId,
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
    // First check if webinar exists in database for this project
    const existingWebinar = await this.getZoomMeetingByMeetingId({
      meetingId: webinarId,
      zoomProjectId: projectId,
      isWebinar: true,
      retry: false,
      adminId,
    });

    if (existingWebinar) {
      this.logger.debug(
        `Webinar ${webinarId} found in database for project ${projectId}, skipping sync`,
      );
      return existingWebinar;
    }

    // Webinar not found, sync from Zoom API
    this.logger.log(
      `Webinar ${webinarId} not found in database for project ${projectId}, syncing from Zoom API`,
    );
    try {
      await this.syncZoomWebinarData(adminId, projectId, webinarId);
    } catch (error) {
      this.logger.error('Error syncing zoom webinar data', error);
      throw error;
    }

    // Return the synced webinar
    const syncedWebinar = await this.getZoomMeetingByMeetingId({
      meetingId: webinarId,
      zoomProjectId: projectId,
      isWebinar: true,
      retry: false,
      adminId,
    });
    if (!syncedWebinar) {
      throw new Error(`Failed to retrieve webinar ${webinarId} after sync`);
    }
    return syncedWebinar;
  }
}
