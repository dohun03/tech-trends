import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRelatedTrendsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다.' })
  @Min(1, { message: 'limit는 최소 1 이상이어야 합니다.' })
  @Max(20, { message: 'limit는 최대 20까지 설정할 수 있습니다.' })
  limit?: number = 5;
}
