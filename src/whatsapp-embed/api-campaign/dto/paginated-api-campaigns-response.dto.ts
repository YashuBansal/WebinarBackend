import { ApiCampaign } from '../api-campaign.schema';

export class PaginationDto {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export class PaginatedApiCampaignsResponseDto {
  campaigns: ApiCampaign[];
  pagination: PaginationDto;
}

