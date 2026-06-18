import { Body, Controller, Get, Param, Patch, Post, UseGuards, Query, Delete } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { ReceivablesService } from './receivables.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { FindReceivablesDto } from './dto/find-receivables.dto';

@Controller('receivables')
@UseGuards(JwtAuthGuard)
export class ReceivablesController {
  constructor(private receivablesService: ReceivablesService) {}
  
    @Get(':id')
    findOne(@Param('id') id: string, @CurrentUser() user: User) {
      return this.receivablesService.findOne(id, user.id);
    }
    
    @Get()
    findAll(@CurrentUser() user: User, @Query() filters: FindReceivablesDto) {
        return this.receivablesService.findAll(user.id, filters);
    }

    @Post()
    create(
        @CurrentUser() user: User,
        @Body() dto: CreateReceivableDto
    ) {
        return this.receivablesService.create(user.id, dto)
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: UpdateReceivableDto,
        @Query('scope') scope?: string,
    ) {
      return this.receivablesService.update(id, user.id, dto, scope);
    }
      
    @Delete(':id')
    remove(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Query('scope') scope?: string,
    ) {
        return this.receivablesService.remove(id, user.id, scope);
    }
}
