import {
  IsString,
  IsOptional,
  IsArray,
  IsMongoId,
  ValidateNested,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";
import { StaffSchedule, StaffDayHours } from "@foodorder/types";

class DayHoursDto implements StaffDayHours {
  @IsString()
  open: string;

  @IsString()
  close: string;

  @IsBoolean()
  enabled: boolean;
}

class ScheduleDto implements StaffSchedule {
  @ValidateNested()
  @Type(() => DayHoursDto)
  monday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  tuesday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  wednesday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  thursday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  friday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  saturday: StaffDayHours;

  @ValidateNested()
  @Type(() => DayHoursDto)
  sunday: StaffDayHours;

  @IsArray()
  @IsString({ each: true })
  blockedDates: string[];
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bio?: string | null;

  @IsOptional()
  @IsString()
  avatar_url?: string | null;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  serviceIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule?: StaffSchedule;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
