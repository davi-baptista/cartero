import { Module } from '@nestjs/common';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [PersonsService],
  exports: [PersonsService],
  controllers: [PersonsController],
})
export class PersonsModule {}
