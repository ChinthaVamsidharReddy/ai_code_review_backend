import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../projects.service';

describe('ProjectsService ownership', () => {
  function makeService(project: any) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(project),
      remove: jest.fn(),
    } as any;
    const configService = { get: jest.fn().mockReturnValue('./storage') } as any;
    return new ProjectsService(repo, configService);
  }

  it('throws NotFoundException when the project does not exist', async () => {
    const service = makeService(null);
    await expect(service.getOwnedProject('missing-id', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when a different user requests the project', async () => {
    const service = makeService({ id: 'p1', ownerId: 'owner-1' });
    await expect(service.getOwnedProject('p1', 'someone-else')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the project when the requesting user is the owner', async () => {
    const project = { id: 'p1', ownerId: 'owner-1' };
    const service = makeService(project);
    await expect(service.getOwnedProject('p1', 'owner-1')).resolves.toBe(project);
  });
});
