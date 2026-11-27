import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CollapsibleSectionComponent } from './collapsible-section.component';

@Component({
  imports: [CollapsibleSectionComponent],
  template: `
    <app-collapsible-section title="Models (2)" [(expanded)]="expanded">
      <button type="button" sectionActions class="action-btn">+ Add</button>
      <p class="body-copy">Section body</p>
    </app-collapsible-section>
  `,
})
class TestHostComponent {
  readonly expanded = signal(true);
}

describe('CollapsibleSectionComponent', () => {
  it('projects header actions and body content and toggles aria-expanded', () => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
    });

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const toggleBtn = root.querySelector('.section-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.action-btn')?.textContent?.trim()).toBe('+ Add');
    expect(root.querySelector('.body-copy')?.textContent?.trim()).toBe('Section body');

    toggleBtn.click();
    fixture.detectChanges();

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.componentInstance.expanded()).toBeFalse();
    expect(root.querySelector('.body-copy')).toBeNull();
  });
});
