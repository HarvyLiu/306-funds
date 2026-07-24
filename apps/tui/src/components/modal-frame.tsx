import type {ReactNode} from 'react';
import {Box, Text} from 'ink';

export interface ModalFrameProps {
  title: string;
  children: ReactNode;
}

export function ModalFrame({title, children}: ModalFrameProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}
