import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { captureException } from '../src/lib/errors';

jest.mock('../src/lib/errors', () => ({ captureException: jest.fn() }));

let shouldThrow = true;
function Fragile() {
  if (shouldThrow) throw new Error('boom');
  return <Text>All good</Text>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports a render error and offers a working retry action', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), expect.anything());

    shouldThrow = false;
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(screen.getByText('All good')).toBeTruthy();
  });
});
