import { render, screen } from '@testing-library/react';
import type { SurveilModelAccess } from '~/components/Surveil/modelAccess';
import type { Endpoint, SelectedValues } from '~/common';
import { EndpointModelItem } from '../EndpointModelItem';

const mockHandleSelectModel = jest.fn();
let mockSelectedValues: SelectedValues;

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    handleSelectModel: mockHandleSelectModel,
    selectedValues: mockSelectedValues,
  }),
}));

jest.mock('~/components/Chat/Menus/Endpoints/CustomMenu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    CustomMenuItem: React.forwardRef(function MockMenuItem(
      { children, ...rest }: { children?: React.ReactNode },
      ref: React.Ref<HTMLDivElement>,
    ) {
      return React.createElement('div', { ref, role: 'menuitem', ...rest }, children);
    }),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const unlockedAccess: SurveilModelAccess = {
  isSurveilEndpoint: () => false,
  hasActiveSubscription: false,
  isFreeModel: () => false,
  isLocked: () => false,
  sortForEndpoint: (_endpoint: string, modelIds: string[]) => modelIds,
};

let mockSurveilAccess: SurveilModelAccess = unlockedAccess;

jest.mock('~/components/Surveil/modelAccess', () => ({
  useSurveilModelAccess: () => mockSurveilAccess,
}));

jest.mock('~/components/Chat/Menus/Endpoints/useActiveItem', () => ({
  __esModule: true,
  default: () => ({ ref: { current: null }, isActive: false }),
}));

const renderItem = (props: Partial<React.ComponentProps<typeof EndpointModelItem>> = {}) =>
  render(
    <EndpointModelItem
      modelId="claude-opus-4-6"
      endpoint={baseEndpoint}
      isFavorite={false}
      onToggleFavorite={jest.fn()}
      {...props}
    />,
  );

const baseEndpoint: Endpoint = {
  value: 'anthropic',
  label: 'Anthropic',
  hasModels: true,
  models: [{ name: 'claude-opus-4-6' }],
  icon: null,
};

describe('EndpointModelItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSurveilAccess = unlockedAccess;
  });

  it('blocks selection and marks the row when the model is locked (no subscription)', () => {
    mockSelectedValues = { endpoint: 'anthropic', model: '', modelSpec: '' };
    mockSurveilAccess = {
      ...mockSurveilAccess,
      isSurveilEndpoint: (value: string) => value === 'anthropic',
      isLocked: () => true,
    };
    renderItem();

    const menuItem = screen.getByRole('menuitem');
    expect(menuItem).toHaveAttribute('aria-disabled', 'true');
    expect(menuItem.className).toContain('cursor-not-allowed');

    menuItem.click();
    expect(mockHandleSelectModel).not.toHaveBeenCalled();
  });

  it('labels free tier models and keeps them selectable without a subscription', () => {
    mockSelectedValues = { endpoint: 'anthropic', model: '', modelSpec: '' };
    mockSurveilAccess = {
      ...mockSurveilAccess,
      isSurveilEndpoint: (value: string) => value === 'anthropic',
      isFreeModel: () => true,
      isLocked: () => false,
    };
    renderItem();

    expect(screen.getByText('com_surveil_free_model')).toBeInTheDocument();

    screen.getByRole('menuitem').click();
    expect(mockHandleSelectModel).toHaveBeenCalledWith(baseEndpoint, 'claude-opus-4-6');
  });

  it('renders checkmark when model and endpoint match with no active spec', () => {
    mockSelectedValues = { endpoint: 'anthropic', model: 'claude-opus-4-6', modelSpec: '' };
    renderItem();

    const menuItem = screen.getByRole('menuitem');
    expect(menuItem).toHaveAttribute('aria-selected', 'true');
  });

  it('does NOT render checkmark when a model spec is active even if endpoint and model match', () => {
    mockSelectedValues = {
      endpoint: 'anthropic',
      model: 'claude-opus-4-6',
      modelSpec: 'my-anthropic-spec',
    };
    renderItem();

    const menuItem = screen.getByRole('menuitem');
    expect(menuItem).not.toHaveAttribute('aria-selected');
  });

  it('does NOT render checkmark when model matches but endpoint differs', () => {
    mockSelectedValues = { endpoint: 'openai', model: 'claude-opus-4-6', modelSpec: '' };
    renderItem();

    const menuItem = screen.getByRole('menuitem');
    expect(menuItem).not.toHaveAttribute('aria-selected');
  });

  it('does NOT render checkmark when endpoint matches but model differs', () => {
    mockSelectedValues = { endpoint: 'anthropic', model: 'claude-sonnet-4-5', modelSpec: '' };
    renderItem();

    const menuItem = screen.getByRole('menuitem');
    expect(menuItem).not.toHaveAttribute('aria-selected');
  });
});
