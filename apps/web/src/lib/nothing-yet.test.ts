import { isNothingYet } from './nothing-yet.js';

describe('isNothingYet', () => {
  it.each(['not found', 'Not found.', '  NOT FOUND  '])(
    'reads %j as an empty install',
    (message) => {
      expect(isNothingYet(message)).toBe(true);
    },
  );

  it.each(['Run not found', 'Database unavailable', 'API answered 404: no such repo', ''])(
    'keeps %j as a real failure, in the server’s words',
    (message) => {
      expect(isNothingYet(message)).toBe(false);
    },
  );
});
