import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';

describe('AuthService', () => {
  const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as any;

  function makeUsersService(existingUser: any = null) {
    return {
      findByEmail: jest.fn().mockResolvedValue(existingUser),
      create: jest.fn().mockImplementation((email, passwordHash, displayName) =>
        Promise.resolve({ id: 'user-1', email, passwordHash, displayName }),
      ),
    } as any;
  }

  it('rejects registration when the email is already taken', async () => {
    const usersService = makeUsersService({ id: 'existing', email: 'a@b.com' });
    const service = new AuthService(usersService, jwtService);
    await expect(
      service.register({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registers a new user and returns a signed token', async () => {
    const usersService = makeUsersService(null);
    const service = new AuthService(usersService, jwtService);
    const result = await service.register({ email: 'new@user.com', password: 'password123' });
    expect(usersService.create).toHaveBeenCalled();
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.user.email).toBe('new@user.com');
  });

  it('rejects login for a non-existent user without revealing that fact', async () => {
    const usersService = makeUsersService(null);
    const service = new AuthService(usersService, jwtService);
    await expect(
      service.login({ email: 'nobody@x.com', password: 'whatever123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login when the password does not match', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    const usersService = makeUsersService({ id: 'u1', email: 'a@b.com', passwordHash: hash });
    const service = new AuthService(usersService, jwtService);
    await expect(
      service.login({ email: 'a@b.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logs in successfully with the correct password', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    const usersService = makeUsersService({ id: 'u1', email: 'a@b.com', passwordHash: hash });
    const service = new AuthService(usersService, jwtService);
    const result = await service.login({ email: 'a@b.com', password: 'correct-password' });
    expect(result.accessToken).toBe('signed.jwt.token');
  });
});
