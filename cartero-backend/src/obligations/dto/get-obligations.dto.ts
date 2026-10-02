import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from 'src/common/pagination/pagination.dto';
import { ObligationDomain, ObligationSection } from '../obligations.types';

export class GetObligationsDto extends CursorPaginationDto {
  @IsEnum(ObligationSection)
  section!: ObligationSection;

  @IsOptional()
  @IsEnum(ObligationDomain)
  domain: ObligationDomain = ObligationDomain.ALL;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  year?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;
}

export class GetObligationsSummaryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  year!: number;

  @IsOptional()
  @IsEnum(ObligationDomain)
  domain: ObligationDomain = ObligationDomain.ALL;

  @IsOptional()
  @IsUUID()
  personId?: string;
}
