import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Roles } from 'src/schemas/Roles.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectModel(Roles.name) private rolesModel: Model<Roles>,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeRoles();
  }

  async initializeRoles() {
    try {
      const rolesEnv = this.configService.get<string>('ROLES');
      if (!rolesEnv) {
        this.logger.warn('ROLES environment variable is not set');
        return;
      }

      // const rolesMap: Record<string, string> = JSON.parse(rolesEnv);

      // for (const [roleName, roleId] of Object.entries(rolesMap)) {
      //   try {
      //     // Check if role with this ID already exists
      //     const existingRole = await this.rolesModel.findById(roleId).exec();

      //     if (!existingRole) {
      //       // Create role with the specified ID
      //       await this.rolesModel.create({
      //         _id: new Types.ObjectId(roleId),
      //         name: roleName,
      //       });
      //       this.logger.log(`Created role: ${roleName} with ID: ${roleId}`);
      //     } else {
      //       // Update role name if it doesn't match (optional - you may want to skip this)
      //       if (existingRole.name !== roleName) {
      //         existingRole.name = roleName;
      //         await existingRole.save();
      //         this.logger.log(`Updated role name: ${roleName} for ID: ${roleId}`);
      //       } else {
      //         this.logger.debug(`Role ${roleName} already exists with ID: ${roleId}`);
      //       }
      //     }
      //   } catch (error) {
      //     this.logger.error(
      //       `Failed to initialize role ${roleName} with ID ${roleId}: ${error.message}`,
      //     );
      //   }
      // }
    } catch (error) {
      this.logger.error(
        `Failed to parse ROLES environment variable: ${error.message}`,
      );
    }
  }

  getRoles() {
    return this.rolesModel.find().exec();
  }

  addRole(name: string) {
    return this.rolesModel.create(name);
  }
  async getRoleNameById(id: string) {
    const role = await this.rolesModel.findById(id).exec();
    if (!role) {
      return 'Unknown Role';
    }
    return role.name;
  }

  async getRoleByName(name: string): Promise<Roles | null> {
    return this.rolesModel.findOne({ name }).exec();
  }
}
