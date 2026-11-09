import type { Meta, StoryObj } from '@storybook/react';
import { Wordmark } from './Wordmark.js';

const meta: Meta<typeof Wordmark> = {
  title: 'Brand/Wordmark',
  component: Wordmark,
  tags: ['autodocs'],
  argTypes: { size: { control: 'select', options: ['sm', 'md', 'lg'] } },
};

export default meta;
type Story = StoryObj<typeof Wordmark>;

export const Chrome: Story = { args: { size: 'md' } };

export const Sizes: Story = {
  render: () => (
    <div className="flex items-baseline gap-6">
      <Wordmark size="sm" />
      <Wordmark size="md" />
      <Wordmark size="lg" />
    </div>
  ),
};
