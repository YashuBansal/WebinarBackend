import {
  Inject,
  forwardRef,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { Notes } from 'src/schemas/Notes.schema';
import { CreateNoteDto } from './dto/notes.dto';
import { UsersService } from 'src/users/users.service';
import { AssignmentService } from 'src/assignment/assignment.service';
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { SocketEvents } from 'src/websocket/dto/socket.dto';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { Attendee } from 'src/schemas/Attendee.schema';

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Notes.name) private readonly notesModel: Model<Notes>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly assignService: AssignmentService,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeeService: AttendeesService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly attendeeLogService: AttendeeLogService,
  ) {}

  async updateAssignmentDateOnNotes(
    noteId: Types.ObjectId,
    attendeeId: Types.ObjectId,
  ) {
    const assignment: any =
      await this.assignService.getAssignmentByAttendeeId(attendeeId);
    if (!assignment && !assignment?.createdAt) return;
    await this.notesModel.updateOne(
      { _id: noteId },
      { $set: { assignmentDate: assignment.createdAt } },
    );
  }

  async createNote(
    body: CreateNoteDto,
    createdBy: string,
    adminId: string,
  ): Promise<Notes | null> {

    const user = await this.usersService.getUserById(createdBy);
    let validCall = false;
    const callDuration = body.callDuration;
    const totalCallDuration: number =
      Number(callDuration.min) * 60 + Number(callDuration.sec);

    if (user && user?.validCallTime) {
      if (totalCallDuration >= user.validCallTime) {
        validCall = true;
      }
    }

    const isAssignment =
      await this.assignService.getActiveAssignmentByAttendeeId(
        new Types.ObjectId(`${body.attendee}`),
      );

    let attendee: Attendee | null = null;

    if (!isAssignment || String(isAssignment?.user) === String(createdBy)) {
      attendee = await this.attendeeService.updateAttendee(
        body.attendee,
        adminId,
        createdBy,
        { status: body.status, ...(validCall ? { validCall } : {}) },
        false,
      );
    } else {
      attendee = await this.attendeeService.getAttendeeById(body.attendee);
    }

    if (!attendee) {
      throw new BadRequestException('Attendee does not exists');
    }

    const note = await this.notesModel.create({
      ...body,
      createdBy,
      isWorked: body.isWorked === 'true' ? true : false,
      adminId: new Types.ObjectId(`${adminId}`),
      webinarId: attendee.webinar,
      callDuration: totalCallDuration,
    });

    this.attendeeLogService.createSingleAttendeeLog({
      attendee: attendee.email,
      item: '',
      action: AttendeeAction.NOTE,
      details: `<span>Note created by <strong>${body.createdBy}</strong> with status: <strong>${body.status}</strong>.</span>`,
      adminId: new Types.ObjectId(`${adminId}`),
    });

    this.websocketGateway.emitSocketEvent(
      adminId,
      SocketEvents.ATTENDEE_STATUS_UPDATE,
      {},
    );
    this.updateAssignmentDateOnNotes(
      note._id as Types.ObjectId,
      attendee._id as Types.ObjectId,
    );
    return note;
  }

  async getNotesByEmail(email: string): Promise<Notes[]> {
    const notes = await this.notesModel
      .find({ email })
      .populate('createdBy', 'userName role')
      .sort({ createdAt: -1 })
      .exec();
    return notes;
  }

  async getNotesByEmployeeId(
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          createdBy: new Types.ObjectId(`${employeeId}`), // Match notes created by this employee
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
      },

      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendee',
        },
      },
      {
        $unwind: '$attendee', // Unwind the attendee array to make it easier to reference fields
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'attendee.webinar',
          // Field in the attendee document referencing webinar
          foreignField: '_id',
          // Field in the webinars collection to match
          as: 'webinar', // Output field for the joined data
        },
      },
      {
        $unwind: '$webinar',
      },
      {
        $addFields: {
          webinarName: '$webinar.webinarName',
          webinarId: '$webinar._id',
        },
      },
      {
        $facet: {
          webinarGroup: [
            {
              $group: {
                _id: '$webinarName',
                webinarId: { $first: '$webinarId' },
              },
            },
          ],
          statusGroup: [
            {
              $group: {
                _id: '$status',
                // Group by the status field
                count: {
                  $sum: 1,
                }, // Count the total for each status
              },
            },
          ],
        },
      },
    ];
    const notes = await this.notesModel.aggregate(pipeline).exec();

    const totalAssignmentsAggregation =
      await this.assignService.fetchTotalAssignmentsForNotes(
        employeeId,
        startDate,
        endDate,
      );

    const totalWorkedPipeline: PipelineStage[] = [
      {
        $match: {
          createdBy: new Types.ObjectId(`${employeeId}`),
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
      },
      {
        $addFields: {
          totalSeconds: {
            $add: [
              {
                $multiply: [
                  {
                    $toInt: '$callDuration.hr',
                  },
                  3600,
                ],
              },
              {
                $multiply: [
                  {
                    $toInt: '$callDuration.min',
                  },
                  60,
                ],
              },
              {
                $toInt: '$callDuration.sec',
              },
            ],
          },
        },
      },
      {
        $match: {
          $or: [
            {
              isWorked: true,
            },
            {
              totalSeconds: {
                $gte: 10,
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$email',
        },
      },
      {
        $group: {
          _id: null,
          totalWorked: {
            $sum: 1,
          },
        },
      },
    ];

    const totalWorkedAggregation =
      await this.notesModel.aggregate(totalWorkedPipeline);

    return {
      metrics: notes,
      totalAssignments: totalAssignmentsAggregation[0]?.totalAssignments || 0,
      totalWorked: totalWorkedAggregation[0]?.totalWorked || 0,
    };
  }

  validateDate(start: string, end: string): { startDate: Date; endDate: Date } {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date cannot be greater than end date',
      );
    }
    return { startDate, endDate };
  }

  async getNotesByAdminId(
    id: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const adminId = new Types.ObjectId(`${id}`);
    // Step 1: Retrieve employees under the given adminId
    const employees = await this.usersService.getEmployeesForNotes(adminId); // Retrieve _id and name for employees
    // Step 2: Aggregate notes for each employee
    const results = await Promise.all(
      employees.map(async (employee) => {
        // console.log(employee);
        const notesAggregation = await this.notesModel.aggregate([
          {
            $match: {
              createdBy: employee._id, // Match notes created by this employee
              $expr: {
                $and: [
                  {
                    $gte: [
                      {
                        $dateFromParts: {
                          year: {
                            $year: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          month: {
                            $month: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          day: {
                            $dayOfMonth: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      startDate,
                    ],
                  },
                  {
                    $lte: [
                      {
                        $dateFromParts: {
                          year: {
                            $year: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          month: {
                            $month: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          day: {
                            $dayOfMonth: {
                              date: '$createdAt',
                              timezone: 'Asia/Kolkata',
                            },
                          },
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      endDate,
                    ],
                  },
                ],
              },
            },
          },
          {
            $lookup: {
              from: 'attendees',
              localField: 'attendee',
              foreignField: '_id',
              as: 'attendee',
            },
          },
          {
            $unwind: '$attendee', // Unwind the attendee array to make it easier to reference fields
          },
          {
            $lookup: {
              from: 'webinars',
              localField: 'attendee.webinar',
              // Field in the attendee document referencing webinar
              foreignField: '_id',
              // Field in the webinars collection to match
              as: 'webinar', // Output field for the joined data
            },
          },
          {
            $unwind: '$webinar',
          },
          {
            $addFields: {
              webinarName: '$webinar.webinarName',
            },
          },
          {
            $facet: {
              webinarGroup: [
                {
                  $group: {
                    _id: '$webinarName',
                  },
                },
              ],
              statusGroup: [
                {
                  $group: {
                    _id: '$status',
                    // Group by the status field
                    count: {
                      $sum: 1,
                    }, // Count the total for each status
                  },
                },
              ],
            },
          },
        ]);

        const totalAssignmentsAggregation =
          await this.assignService.fetchAssignmentsForNotes(
            employee._id as Types.ObjectId,
            startDate,
            endDate,
          );

        const totalWorkedPipeline: PipelineStage[] = [
          {
            $match: {
              createdBy: new Types.ObjectId(`${employee._id}`),
              createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $addFields: {
              totalSeconds: {
                $add: [
                  {
                    $multiply: [
                      {
                        $toInt: '$callDuration.hr',
                      },
                      3600,
                    ],
                  },
                  {
                    $multiply: [
                      {
                        $toInt: '$callDuration.min',
                      },
                      60,
                    ],
                  },
                  {
                    $toInt: '$callDuration.sec',
                  },
                ],
              },
            },
          },
          {
            $match: {
              $or: [
                {
                  isWorked: true,
                },
                {
                  totalSeconds: {
                    $gte: 10,
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: '$email',
            },
          },
          {
            $group: {
              _id: null,
              totalWorked: {
                $sum: 1,
              },
            },
          },
        ];

        const totalWorkedAggregation =
          await this.notesModel.aggregate(totalWorkedPipeline);

        return {
          email: employee.email, // Add employee name
          userName: employee.userName,
          metrics: notesAggregation,
          totalAssignments:
            totalAssignmentsAggregation[0]?.totalAssignments || 0,
          totalWorked: totalWorkedAggregation[0]?.totalWorked || 0,
        };
      }),
    );

    return results;
  }

  async deleteNotesByAttendees(
    session: ClientSession,
    attendees: Types.ObjectId[],
  ) {
    console.log('notes -> deleted');
    return this.notesModel
      .deleteMany({ attendee: { $in: attendees } })
      .session(session)
      .exec();
    // TODO: Delete images from cloudinary
  }

  async fetchNotesDataForClientDashboard(attendees: Types.ObjectId[]) {
    const pipeline = [
      // ==========================================================================
      // Pipeline Goal: For a specific admin and webinar, calculate per user:
      // 1. Total count for each distinct status ('JOINED', 'LEFT', etc.).
      // 2. The maximum call duration for each unique attendee associated with that user.
      // ==========================================================================

      // Stage 1: Initial Filtering
      // Select relevant documents based on admin, webinar, and valid call duration.
      {
        $match: {
          attendee: {
            $in: attendees,
          },

          // --- Ensure data quality: only consider records with a non-negative duration ---
          callDuration: { $gte: 0 },
        },
      },

      // Stage 2: First Grouping - Aggregate by User, Attendee, and Status
      // This stage handles potential multiple entries for the same user/attendee/status combo.
      // It finds the maximum duration and determines if 'isWorked' was true for *any* record in this specific combo.
      {
        $group: {
          _id: {
            user: '$createdBy', // Grouping key component 1
            attendee: '$attendee', // Grouping key component 2
            status: '$status', // Grouping key component 3
          },
          // Find the longest duration recorded for this specific user/attendee/status tuple
          maxDurationForThisCombo: { $max: '$callDuration' },
          // Determine if 'isWorked' is true for any document in this combo ($max treats true > false)
          isWorkedForThisCombo: { $max: '$isWorked' }, // Changed name for clarity
          // Count how many documents match this specific user/attendee/status tuple
          countForThisCombo: { $sum: 1 },
        },
      },

      // Stage 3: Second Grouping - Consolidate Data Per User
      // Group the results from Stage 2 by user only.
      // Prepare arrays of data needed for the final calculations in the $project stage.
      {
        $group: {
          _id: '$_id.user', // Final grouping key: the user ('createdBy')

          // Collect all max durations and 'isWorked' flags per attendee FOR THIS USER.
          // This array might contain multiple entries for the same attendee if they had different statuses.
          attendeeDataInput: {
            // Renamed for clarity as it now holds more than just duration
            $push: {
              attendee: '$_id.attendee',
              duration: '$maxDurationForThisCombo',
              isWorked: '$isWorkedForThisCombo', // Pass the calculated 'isWorked' flag
            },
          },

          // Collect all status counts FOR THIS USER (remains unchanged).
          statusCountsInput: {
            $push: {
              status: '$_id.status',
              count: '$countForThisCombo',
            },
          },
        },
      },

      // Stage 4: Final Projection and Calculation
      // Reshape the output and perform the final calculations.
      {
        $project: {
          _id: 0, // Exclude the default MongoDB _id
          user: '$_id', // Rename the grouped _id (which is the user) to 'user'

          // --- Calculate Final Status Counts --- (Logic remains unchanged)
          statusCounts: {
            $map: {
              input: {
                $objectToArray: {
                  $reduce: {
                    input: '$statusCountsInput',
                    initialValue: {},
                    in: {
                      $let: {
                        vars: {
                          currentStatus: '$$this.status',
                          currentCount: '$$this.count',
                          accumulatedCount: {
                            $ifNull: [
                              {
                                $getField: {
                                  field: '$$this.status',
                                  input: '$$value',
                                },
                              },
                              0,
                            ],
                          },
                        },
                        in: {
                          $mergeObjects: [
                            '$$value',
                            {
                              $arrayToObject: [
                                [
                                  [
                                    '$$currentStatus',
                                    {
                                      $add: [
                                        '$$accumulatedCount',
                                        '$$currentCount',
                                      ],
                                    },
                                  ],
                                ],
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              as: 'statusTotal',
              in: { status: '$$statusTotal.k', count: '$$statusTotal.v' },
            },
          },

          // --- Calculate Max Duration & Overall 'isWorked' Per Unique Attendee ---
          // Goal: Transform attendeeDataInput into [{ attendee: 'A1', callDuration: D1, isWorked: W1 }, ...]
          // where D1 is the max duration for A1, and W1 is true if *any* record for A1 had isWorked: true.
          attendeeDurations: {
            // Pattern: Use $reduce to aggregate into an object map { attendeeIdStr: { duration: maxD, worked: maxW } },
            // then $objectToArray + $map to convert back to the desired array format.
            $map: {
              input: {
                $objectToArray: {
                  // 3. Convert the aggregated object back to an array: [{ k: attendeeIdStr, v: { duration: D, worked: W } }]
                  $reduce: {
                    // 1. Process the input array to find the max duration and overall 'isWorked' per attendee
                    input: '$attendeeDataInput', // The array from Stage 3: [{ attendee: OID, duration: D, isWorked: W }, ...]
                    initialValue: {}, // 2. Start with an empty object accumulator: { attendeeIdStr: { duration: maxD, worked: maxW } }
                    in: {
                      // $$value = the accumulator object being built (e.g., { 'attendeeA_str': { duration: 120, worked: false } })
                      // $$this = the current element being processed (e.g., { attendee: ObjectId('A'), duration: 50, isWorked: true })
                      $let: {
                        // --- Variables needed for the calculation ---
                        vars: {
                          // Key for the accumulator object must be a string
                          currentAttendeeStr: { $toString: '$$this.attendee' },
                          // Safely get the *entire* data object previously accumulated for this attendee.
                          // Default to { duration: 0, worked: false } if this is the first time seeing this attendee.
                          existingDataForAttendee: {
                            $ifNull: [
                              // Attempt to get the object stored under the attendee's string ID in the accumulator ($$value)
                              {
                                $getField: {
                                  field: { $toString: '$$this.attendee' },
                                  input: '$$value',
                                },
                              },
                              // Default value if the field doesn't exist in $$value yet
                              { duration: 0, worked: false },
                            ],
                          },
                        },
                        // --- Perform calculations and update accumulator ---
                        // The 'in' block can safely use variables defined in the 'vars' block above.
                        in: {
                          // Merge the existing accumulator ($$value) with a *new* object.
                          // This new object contains only one key: the current attendee's string ID.
                          // The value for this key is an updated object with the calculated max duration and overall worked status.
                          $mergeObjects: [
                            '$$value', // Start with the accumulator as it is
                            {
                              // Create the single-entry object to merge { attendeeIdStr: { updated data } }
                              $arrayToObject: [
                                [
                                  [
                                    // Creates a key-value pair array: [ [ key, value ] ]
                                    '$$currentAttendeeStr', // The key: e.g., "67f..."
                                    {
                                      // The value: an object containing the new aggregated data
                                      duration: {
                                        $max: [
                                          '$$existingDataForAttendee.duration',
                                          '$$this.duration',
                                        ],
                                      }, // Calculate new max duration
                                      worked: {
                                        $max: [
                                          '$$existingDataForAttendee.worked',
                                          '$$this.isWorked',
                                        ],
                                      }, // Calculate new overall worked status (true > false)
                                    },
                                  ],
                                ],
                              ],
                            },
                          ],
                        },
                      }, // End of $let
                    }, // End of $reduce.in
                  }, // End of $reduce
                }, // End of $objectToArray
              }, // End of input for $map
              as: 'attendeeAggregated', // Variable name for items like { k: 'attendeeA_str', v: { duration: 120, worked: true } }
              in: {
                // 4. Format each item into the final desired structure
                attendee: '$$attendeeAggregated.k', // The attendee ID (as string)
                callDuration: '$$attendeeAggregated.v.duration', // The overall max duration
                isWorked: '$$attendeeAggregated.v.worked', // The overall 'isWorked' status (true if ever true)
              },
            }, // End of $map for attendeeDurations
          }, // End of attendeeDurations field
        }, // End of $project stage
      },
    ];
    return this.notesModel.aggregate(pipeline).exec();
  }

  async fetchNotesForAdmin(
    adminId: Types.ObjectId,
    startDate: string,
    endDate: string,
    webinarId?: string,
  ) {
    const endDatePlusOneDay = new Date(endDate);

    let query = {};
    if (mongoose.isValidObjectId(webinarId)) {
      const webinarAttendees =
        await this.attendeeService.fetchAttendeesByWebinar(webinarId);

      query = {
        attendee: { $in: webinarAttendees.map((attendee) => attendee._id) },
      };
    } else {
      query = {
        createdBy: adminId,
      };
    }
    const startDatenew = new Date(startDate);
    console.log(query, 'query', startDatenew, endDatePlusOneDay);

    const pipeline = [
      {
        $match: {
          ...query,
          createdAt: {
            $gte: startDatenew,
            $lte: endDatePlusOneDay, // Use $lt to include the entire end date
          },
        },
      },
      {
        $group: {
          _id: '$attendee',
          status: {
            $push: '$status',
          },
        },
      },
    ];

    const data = await this.notesModel.aggregate(pipeline).exec();

    return {
      data,
      success: true,
      message: 'Notes fetched successfully',
    };
  }
}
