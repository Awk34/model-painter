import { TestBed } from '@angular/core/testing';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintActionRowComponent } from './paint-action-row.component';

describe('PaintActionRowComponent', () => {
  function setup(ownedIds: string[] = [], wishIds: string[] = []) {
    const openPaint = jasmine.createSpy('openPaint');
    const toggleInventory = jasmine.createSpy('toggleInventory');
    const toggleWishlist = jasmine.createSpy('toggleWishlist');

    TestBed.configureTestingModule({
      imports: [PaintActionRowComponent],
      providers: [
        { provide: PaintModalService, useValue: { openPaint } },
        {
          provide: UserStateService,
          useValue: {
            isOwned: (id: string) => ownedIds.includes(id),
            isWishlisted: (id: string) => wishIds.includes(id),
            toggleInventory,
            toggleWishlist,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(PaintActionRowComponent);
    fixture.componentRef.setInput('paintId', 'p1');
    fixture.componentRef.setInput('name', 'Macragge Blue');
    fixture.componentRef.setInput('subtitle', 'Base');
    fixture.componentRef.setInput('hex', '#0D407F');
    return { fixture, openPaint, toggleInventory, toggleWishlist };
  }

  it('opens paint modal on click and renders accessible wishlist aria-label in full mode', () => {
    const { fixture, openPaint, toggleInventory, toggleWishlist } = setup([], []);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    (root.querySelector('.par-main') as HTMLButtonElement).click();
    expect(openPaint).toHaveBeenCalledWith('p1');

    const buttons = Array.from(root.querySelectorAll('.par-actions button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons[1].getAttribute('aria-label')).toBe('Add to wishlist: Macragge Blue');

    buttons[0].click();
    buttons[1].click();
    expect(toggleInventory).toHaveBeenCalledWith('p1');
    expect(toggleWishlist).toHaveBeenCalledWith('p1');
  });

  it('renders substitute badge, deltaE badge, compact-own, and owned-badge modes', () => {
    const { fixture, openPaint } = setup([], []);
    fixture.componentRef.setInput('substitute', {
      requiredPaintId: 'p1',
      substitutePaintId: 'tp1',
      substituteName: 'Ultramarine Blue',
      substituteBrand: 'Army Painter',
      matchType: 'third_party',
    });
    fixture.componentRef.setInput('deltaE', 1.4);
    fixture.componentRef.setInput('matchQuality', 'exact');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.delta-badge')?.textContent).toContain('ΔE 1.4');
    const subBtn = root.querySelector('.badge-sub') as HTMLButtonElement;
    expect(subBtn.textContent).toContain('Covered by Ultramarine Blue');
    subBtn.click();
    expect(openPaint).toHaveBeenCalledWith('p1');

    fixture.componentRef.setInput('actionMode', 'compact-own');
    fixture.detectChanges();
    expect(root.querySelector('.par-actions button')?.textContent?.trim()).toBe('+');

    fixture.componentRef.setInput('actionMode', 'owned-badge');
    fixture.detectChanges();
    expect(root.querySelector('.par-actions .badge-owned')?.textContent?.trim()).toBe('✓ Owned');
  });
});
