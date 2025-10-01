import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      finalize(() => {
        const duration = (Date.now() - startTime) / 1000;
        const route = this.getRoutePattern(context);
        const method = request.method;
        const status = response.statusCode.toString();

        if (route !== '/metrics') {
          this.metricsService.requestLatency
            .labels({ route, method, status })
            .observe(duration);

          this.metricsService.requestCount
            .labels({ route, method, status })
            .inc();
        }
      }),
    );
  }

  private getRoutePattern(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();

    if (request.route?.path) {
      const baseUrl = request.baseUrl || '';
      let routePath = request.route.path;

      if (baseUrl && !routePath.startsWith(baseUrl)) {
        routePath = baseUrl + routePath;
      }

      return routePath.startsWith('/') ? routePath : `/${routePath}`;
    }

    let path = request.path || request.url;
    if (path.includes('?')) {
      path = path.split('?')[0];
    }

    return path.startsWith('/') ? path : `/${path}`;
  }
}
