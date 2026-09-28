import { retrieveRelevantFiles } from '../context-retrieval';
import { CodeFile } from '../../files/code-file.entity';

function makeFile(relativePath: string): CodeFile {
  return { relativePath } as CodeFile;
}

describe('retrieveRelevantFiles', () => {
  const files = [
    { file: makeFile('src/auth/auth.service.ts'), content: 'export class AuthService { login() {} }' },
    { file: makeFile('src/payments/stripe.service.ts'), content: 'export class StripeService { charge() {} }' },
    { file: makeFile('README.md'), content: 'This project is named DemoApp. It has a project overview.' },
  ];

  it('returns no files for a generic question with only stopwords ("what is the project name?")', () => {
    // This is the exact regression this function exists to prevent: a
    // trivial factual question should not drag in file content just
    // because generic words like "project" and "name" appear everywhere.
    const result = retrieveRelevantFiles('what is the project name?', files);
    expect(result).toHaveLength(0);
  });

  it('matches a file whose path clearly relates to the question', () => {
    const result = retrieveRelevantFiles('how does authentication work?', files);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].file.relativePath).toBe('src/auth/auth.service.ts');
  });

  it('ranks a path match above a body-only match', () => {
    const result = retrieveRelevantFiles('stripe payments charge', files);
    expect(result[0].file.relativePath).toBe('src/payments/stripe.service.ts');
  });

  it('returns an empty array when nothing scores above the relevance threshold', () => {
    const result = retrieveRelevantFiles('xyzxyz nonexistent keyword', files);
    expect(result).toHaveLength(0);
  });
});
