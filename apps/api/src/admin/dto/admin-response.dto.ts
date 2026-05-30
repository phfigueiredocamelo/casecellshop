import { ApiProperty } from '@nestjs/swagger';

export class SyncErpResponseDto {
  @ApiProperty()
  synced!: number;

  @ApiProperty()
  catalogVersion!: number;
}

export class ReconcileResponseDto {
  @ApiProperty()
  repaired!: number;

  @ApiProperty()
  divergences!: number;
}
