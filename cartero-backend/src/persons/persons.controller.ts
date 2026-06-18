import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { FindPersonsDto } from './dto/find-persons.dto';
import { GetStatementDto } from './dto/get-statement.dto';

@Controller('persons')
@UseGuards(JwtAuthGuard)
export class PersonsController {
  constructor(private PersonsService: PersonsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreatePersonDto) {
    return this.PersonsService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.PersonsService.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.PersonsService.remove(id, user.id);
  }
  
  @Get(':id/statement') 
  getStatement(@Param('id') id: string, @CurrentUser() user: User, @Query() filters: GetStatementDto) {
    return this.PersonsService.getStatement(id, user.id, filters);
  }
  
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.PersonsService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindPersonsDto) {
    return this.PersonsService.findAll(user.id, filters);
  }
}
