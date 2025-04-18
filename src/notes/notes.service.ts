import {
  Inject,
  forwardRef,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { Notes } from 'src/schemas/Notes.schema';
import { CreateNoteDto } from './dto/notes.dto';
import { UsersService } from 'src/users/users.service';
import { AssignmentService } from 'src/assignment/assignment.service';
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { SocketEvents } from 'src/websocket/dto/socket.dto';

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
  ) {}

  async createNote(
    body: CreateNoteDto,
    createdBy: string,
    adminId: string,
  ): Promise<Notes | null> {
    //check if note's callduration >= user's validCallTime to add validCall: true in attendee

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

    const attendee = await this.attendeeService.updateAttendee(
      body.attendee,
      adminId,
      createdBy,
      { status: body.status, ...(validCall ? { validCall } : {}) },
    );

    const note = await this.notesModel.create({
      ...body,
      createdBy,
      isWorked: body.isWorked === 'true' ? true : false,
      adminId: new Types.ObjectId(`${adminId}`),
      webinarId: attendee.webinar,
      callDuration: totalCallDuration
    });

    this.websocketGateway.emitSocketEvent(
      adminId,
      SocketEvents.ATTENDEE_STATUS_UPDATE,
      {},
    );
    return note;
  }

  async getNotesByEmail(email: string): Promise<Notes[]> {
    const notes = await this.notesModel
      .find({ email })
      .populate('createdBy', 'userName')
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

  async fetchNotesDataForClientDashboard(
    adminId: Types.ObjectId,
    webinarId?: Types.ObjectId,
  ) {
    const pipeline = [
      {
        $match: {
          // Use the actual ObjectId string representation or a variable
          adminId,
          webinarId,
        },
      },
      {
        // First group: Count by user and status combination
        $group: {
          _id: {
            // Compound key
            user: '$createdBy',
            status: '$status',
          },
          count: { $sum: 1 },
        },
      },
      {
        // Second group: Group by user, collecting status counts
        $group: {
          _id: '$_id.user', // Group by the 'user' part of the previous _id
          statusCounts: {
            $push: {
              // Push a specific document structure, not $$ROOT
              status: '$_id.status', // Get status from the previous _id
              count: '$count', // Get count from the previous stage
            },
          },
        },
      },
      // Optional: Rename _id to 'user' if preferred
      {
        $project: {
          _id: 0, // Remove the default _id
          user: '$_id', // Rename the grouped _id to 'user'
          statusCounts: 1, // Keep the statusCounts array
        },
      },
    ];
  }
}


// [ // Replace db.collection with your actual collection name
//   // Stage 1: Initial Filtering
//   {
//     $match: {
//       // --- Use your actual adminId ---
//       adminId: ObjectId('67f3af912b0a6c6292117f47'),
//       // --- Ensure callDuration is valid and filter out irrelevant ones ---
//       callDuration: { $gte: 0 }
//     }
//   },

//   // Stage 2: First Grouping - Granular data collection
//   {
//     $group: {
//       _id: {
//         // Group by the combination needed for intermediate calculations
//         user: '$createdBy',
//         attendee: '$attendee',
//         status: '$status'
//       },
//       // Find the maximum duration within this specific user/attendee/status combo
//       maxDurationForCombo: { $max: '$callDuration' },
//       // Count documents matching this specific user/attendee/status combo
//       countForCombo: { $sum: 1 }
//     }
//   },

//   // Stage 3: Second Grouping - Consolidate by User
//   {
//     $group: {
//       _id: '$_id.user', // Final grouping key: user

//       // Collect data needed to find the overall max duration per attendee for this user
//       attendeeDurations: {
//         $push: {
//           attendee: '$_id.attendee',
//           duration: '$maxDurationForCombo' // Push attendee and the max duration found for their combo(s)
//         }
//       },

//       // Collect data needed to sum up counts for each status for this user
//       statusCountsInput: {
//         $push: {
//           status: '$_id.status',
//           count: '$countForCombo' // Push status and the count found for its combo(s)
//         }
//       },
//     }
//   },

//   // Stage 4: Final Processing and Shaping the Output
//   {
//     $project: {
//       _id: 0,       // Exclude the default _id field
//       user: '$_id', // Rename _id to 'user'

// 		attendeeDurations: 1,
//       // Calculate final status counts (as an array of {k: status, v: count})
//       statusCounts: {
//         $map: { // Convert the result object back to an array
//           input: {
//             $objectToArray: { // First convert the reduced object to an array
//               // Use $reduce to process the input array and sum counts per status
//               $reduce: {
//                 input: '$statusCountsInput',
//                 initialValue: {}, // Start with an empty object { status: totalCountSoFar }
//                 in: {
//                   $let: {
//                     vars: {
//                       currentStatus: '$$this.status',
//                       currentCount: '$$this.count',
//                       // Get count already stored for this status, default to 0 if none
//                       existingCount: { $ifNull: [ { $getField: { field: '$$this.status', input: '$$value' } }, 0 ] }
//                     },
//                     in: {
//                       // Merge existing results with the updated count for the current status
//                       $mergeObjects: [
//                         '$$value',
//                         // Create object { status: updatedTotalCount }
//                         { $arrayToObject: [[ [ '$$currentStatus', { $add: [ '$$existingCount', '$$currentCount' ] } ] ]] }
//                       ]
//                     }
//                   }
//                 }
//               }
//             }
//           },
//           as: "statusCount", // Variable name for each element in the mapped array
//           in: { // Define the structure of each element in the final output array
//             status: '$$statusCount.k',
//             count: '$$statusCount.v'
//           }
//         }
//       },

//     }
//   }
// ]