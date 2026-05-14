import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [CategoriesService],
  exports: [CategoriesService],
  controllers: [CategoriesController],
})
export class CategoriesModule {}
