import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Body, Button, Screen, Title } from './ui';
import { captureException } from '../lib/errors';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render-time errors and offers a way to retry instead of a red screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Screen>
          <Title>Something went wrong</Title>
          <Body muted>
            The app hit an unexpected error. It has been reported; try again, or restart the app if the problem
            continues.
          </Body>
          <Button label="Try again" onPress={() => this.setState({ error: null })} />
        </Screen>
      );
    }
    return this.props.children;
  }
}
