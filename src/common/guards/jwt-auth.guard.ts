import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protects a route with JWT bearer authentication. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
