import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CommitmentsService } from './commitments.service';

@Controller('commitments')
@UseGuards(JwtAuthGuard)
export class CommitmentsController {
  constructor(private commitmentsService: CommitmentsService) {}

  @Get()
  getCommitments(@CurrentUser() user: User) {
    return this.commitmentsService.getCommitments(user.id);
  }
}
