import { TestBed } from '@angular/core/testing';
import { InventoryReadinessResult, StagedReadinessResult } from '../../core/models/catalog.models';
import { StageReadinessBarsComponent } from './stage-readiness-bars/stage-readiness-bars.component';
import { StageReadinessPillsComponent } from './stage-readiness-pills/stage-readiness-pills.component';

function makeStage(overrides: Partial<InventoryReadinessResult>): InventoryReadinessResult {
  return {
    totalRequired: 4,
    ownedDirectCount: 2,
    substitutedCount: 1,
    missingCount: 1,
    matchPercent: 75,
    ownedDirectIds: ['p1', 'p2'],
    substitutedByPaintId: {},
    missingPaintIds: ['p4'],
    ...overrides,
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeStage({ matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  detail: makeStage({ matchPercent: 75, missingCount: 1, missingPaintIds: ['p4'] }),
  artificer: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  overall: makeStage({ matchPercent: 80 }),
};

describe('StageReadinessPillsComponent & StageReadinessBarsComponent', () => {
  it('renders 3 stage pills with expected readiness states in StageReadinessPillsComponent', () => {
    TestBed.configureTestingModule({
      imports: [StageReadinessPillsComponent],
    });
    const fixture = TestBed.createComponent(StageReadinessPillsComponent);
    fixture.componentRef.setInput('staged', SAMPLE_STAGED);
    fixture.detectChanges();

    const pills = fixture.nativeElement.querySelectorAll('.card-stage-pill');
    expect(pills.length).toBe(3);
    expect(pills[0].textContent).toContain('100%');
    expect(pills[1].textContent).toContain('75%');
    expect(pills[2].textContent).toContain('—');
  });

  it('emits stageClick and wishlistMissing from StageReadinessBarsComponent', () => {
    TestBed.configureTestingModule({
      imports: [StageReadinessBarsComponent],
    });
    const fixture = TestBed.createComponent(StageReadinessBarsComponent);
    fixture.componentRef.setInput('staged', SAMPLE_STAGED);
    fixture.detectChanges();

    let clickedStage: string | undefined;
    let wishlistedIds: string[] | undefined;
    fixture.componentInstance.stageClick.subscribe((s) => {
      clickedStage = s;
    });
    fixture.componentInstance.wishlistMissing.subscribe((ids) => {
      wishlistedIds = ids;
    });

    const rows = fixture.nativeElement.querySelectorAll('.stage-ready-row');
    expect(rows.length).toBe(3);
    expect(rows[1].querySelectorAll('button button, a button, button a').length).toBe(0);

    const stageBtn: HTMLButtonElement | null = rows[1].querySelector('.stage-ready-btn');
    expect(stageBtn).not.toBeNull();
    stageBtn?.click();
    expect(clickedStage).toBe('detail');

    const wishlistBtn: HTMLButtonElement | null = rows[1].querySelector('.stage-wish-btn');
    expect(wishlistBtn).not.toBeNull();
    wishlistBtn?.click();
    expect(wishlistedIds).toEqual(['p4']);
  });
});
