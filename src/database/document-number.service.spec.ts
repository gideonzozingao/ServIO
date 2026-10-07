import { Test, TestingModule } from '@nestjs/testing';
import { DocumentNumberService } from './document-number.service.js';

describe('DocumentNumberService', () => {
  let service: DocumentNumberService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentNumberService],
    }).compile();

    service = module.get<DocumentNumberService>(DocumentNumberService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
