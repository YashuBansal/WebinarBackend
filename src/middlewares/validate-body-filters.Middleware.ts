import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { SubscriptionService } from 'src/subscription/subscription.service';

@Injectable()
export class ValidateBodyFilters implements NestMiddleware {
  constructor(private readonly subService: SubscriptionService) {}
  async use(req: Request, res: Response, next: NextFunction) {
    let { filters = {}, columns = [], fieldName = '' } = req.body;

    let isBody = true;

    const userId = req.id;
    if (!fieldName) {
      const {
        filters: queryFilters = {},
        columns: queryColumns = [],
        fieldName: queryFieldname = '',
      } = req.query;

      filters = queryFilters;
      columns = queryColumns;
      fieldName = queryFieldname;
      isBody = false;
    }


    if (!fieldName) {
      throw new BadRequestException(
        'Field name is required in the request body or query parameters.',
      );
    }

    if (
      userId === undefined ||
      userId === null ||
      mongoose.isValidObjectId(userId) === false
    ) {
      throw new BadRequestException('User ID is required in the request.');
    }

    const subscription = await this.subService.getSubscription(userId);

    if (!subscription) {
      throw new BadRequestException('No Subscription Found with the given ID.');
    }
    const tableConfig: Map<string, any> =
      subscription?.plan?.[fieldName] || new Map();

    const allowedFilters = Object.keys(filters).reduce(
      (acc, key) => {
        if (tableConfig.has(key)) {
          const columnConfig = tableConfig.get(key);
          if (columnConfig?.filterable) acc[key] = filters[key];
        }
        return acc;
      },
      {} as Record<string, any>,
    );
    const allowedColumns = columns.filter((column) => {
      if (tableConfig.has(column)) {
        const columnConfig = tableConfig.get(column);
        if (columnConfig?.downloadable) return true;
      }

      return false;
    });
    // Replace the original body with the filtered one
    if (isBody) {
      req.body = {
        ...req.body,
        filters: allowedFilters,
        columns: allowedColumns,
      };
    } else {
      req.query = {
        ...req.query,
        filters: allowedFilters,
        columns: allowedColumns,
      };
    }


    // Proceed to the next middleware or route handler
    next();
  }
}
