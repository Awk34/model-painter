import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import { UserStateService } from '../../../core/services/user-state.service';
import { DeskHeaderComponent } from './desk-header.component';

describe('DeskHeaderComponent', () => {
  it('renders title, subtitle, 6 KPI pills, and emits tab navigation events', () => {
    TestBed.configureTestingModule({
      imports: [DeskHeaderComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            projects: signal([{ id: 'p1' }, { id: 'p2' }]),
            inventoryModelIds: signal(['m1']),
            wishlistModelIds: signal(['m2', 'm3']),
            inventoryPaintIds: signal(['pt1', 'pt2', 'pt3']),
            wishlistPaintIds: signal(['pt4']),
            allUploadedPhotos: signal([{ sizeBytes: 2048 }]),
            limits: USER_LIMITS,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(DeskHeaderComponent);
    fixture.componentRef.setInput('icon', 'profile');
    fixture.componentRef.setInput('title', 'Account & Data Sync');
    fixture.componentRef.setInput('subtitle', 'Manage auth and sync.');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Account & Data Sync');
    expect(root.querySelectorAll('.kpi-pill').length).toBe(6);

    const projectsSpy = jasmine.createSpy('projectsClick');
    const modelsSpy = jasmine.createSpy('modelsClick');
    const paintsSpy = jasmine.createSpy('paintsClick');
    fixture.componentInstance.projectsClick.subscribe(projectsSpy);
    fixture.componentInstance.modelsClick.subscribe(modelsSpy);
    fixture.componentInstance.paintsClick.subscribe(paintsSpy);

    const buttons = Array.from(root.querySelectorAll('button.kpi-pill')) as HTMLButtonElement[];
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();
    buttons[3].click();
    buttons[4].click();

    expect(projectsSpy).toHaveBeenCalledTimes(1);
    expect(modelsSpy.calls.allArgs()).toEqual([['inventory'], ['wishlist']]);
    expect(paintsSpy.calls.allArgs()).toEqual([['inventory'], ['wishlist']]);
  });
});
