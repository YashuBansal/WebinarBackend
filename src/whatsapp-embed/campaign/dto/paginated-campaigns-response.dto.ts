import { Campaign } from '../../../schemas/whatsapp-embed/campaign.schema';

export class PaginationDto {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export class PaginatedCampaignsResponseDto {
  campaigns: Campaign[];
  pagination: PaginationDto;
}
