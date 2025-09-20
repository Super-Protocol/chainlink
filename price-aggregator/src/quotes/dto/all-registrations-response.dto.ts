import { ApiProperty } from '@nestjs/swagger';

import { RegistrationResponseDto } from './registration-response.dto';

export class AllRegistrationsResponseDto {
  @ApiProperty({
    description: 'Array of all pair-source registrations',
    type: [RegistrationResponseDto],
  })
  registrations: RegistrationResponseDto[];
}
