import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller('menu')
export class MenuController {
  constructor(private readonly catalog: CatalogService) {}

  /** Full menu tree for clients. ETag + If-None-Match → 304 (offline cache refresh). */
  @Get()
  async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { etag, body } = await this.catalog.getMenu();
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return;
    }
    return body;
  }
}
