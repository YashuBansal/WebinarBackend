import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAddonPurchaseDto {
  @IsNotEmpty()
  @IsMongoId()
  addonId: string;
}

export class GetAddonPurchaseParamsDto {
  @IsNotEmpty()
  @IsMongoId()
  purchaseId: string;
}

export class GetAddonPurchaseQueryDto {
  @IsOptional()
  @IsString()
  expand?: 'order' | 'none';
}
