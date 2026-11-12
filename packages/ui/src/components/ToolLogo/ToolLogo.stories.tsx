import type { Meta, StoryObj } from '@storybook/react';
import { ToolLogo } from './ToolLogo.js';

const meta: Meta<typeof ToolLogo> = {
  title: 'Brand/ToolLogo',
  component: ToolLogo,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof ToolLogo>;

export const Set: Story = {
  render: () => (
    <div className="flex gap-3">
      {['Vitest', 'Cypress', 'ESLint', 'Snyk', 'Postman', 'mabl'].map((name) => (
        <ToolLogo key={name} name={name} />
      ))}
    </div>
  ),
};
