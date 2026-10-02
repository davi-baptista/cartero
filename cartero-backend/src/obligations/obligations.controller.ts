import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import {
  GetObligationsDto,
  GetObligationsSummaryDto,
} from './dto/get-obligations.dto';
import { ObligationsService } from './obligations.service';

@Controller('obligations')
@UseGuards(JwtAuthGuard)
export class ObligationsController {
  constructor(private readonly obligationsService: ObligationsService) {}

  @Get('summary')
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: GetObligationsSummaryDto,
  ) {
    return this.obligationsService.getSummary(user.id, user.timeZone, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: GetObligationsDto,
  ) {
    return this.obligationsService.findAll(user.id, user.timeZone, dto);
  }
}
