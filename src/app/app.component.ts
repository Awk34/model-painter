import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { CatalogService } from './core/services/catalog.service';
import { UserStateService } from './core/services/user-state.service';
import { PaintDetailModalComponent } from './shared/components/paint-detail-modal/paint-detail-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule, PaintDetailModalComponent],
  template: `
    <div class="app-shell">
      <!-- Desktop Left Navigation Sidebar -->
      <aside class="sidebar">
        <div class="brand-box" routerLink="/hobby-desk">
          <div class="brand-crest">
            <img src="/icons/ic_warhammerpro.svg" alt="" class="crest-img" />
          </div>
          <div class="brand-titles">
            <span class="brand-main">CITADEL COLOUR</span>
            <span class="brand-sub">Paint Warhammer Web</span>
          </div>
        </div>

        <nav class="side-nav">
          <a
            routerLink="/hobby-desk"
            routerLinkActive="active"
            class="nav-link"
          >
            <img src="/icons/ic_hobby_desk.svg" alt="" class="nav-ic" />
            <span>Hobby Desk</span>
            @if (userState.projects().length > 0) {
              <span class="nav-count">{{ userState.projects().length }}</span>
            }
          </a>

          <a
            routerLink="/models"
            routerLinkActive="active"
            class="nav-link"
          >
            <img src="/icons/ic_models.svg" alt="" class="nav-ic" />
            <span>Paint A Model</span>
            <span class="nav-count muted">{{ catalog.models().length | number }}</span>
          </a>

          <a
            routerLink="/colours"
            routerLinkActive="active"
            class="nav-link"
          >
            <img src="/icons/ic_colour.svg" alt="" class="nav-ic" />
            <span>Paint A Colour</span>
            <span class="nav-count muted">{{ catalog.colours().length }}</span>
          </a>

          <a
            routerLink="/search"
            routerLinkActive="active"
            class="nav-link"
          >
            <img src="/icons/ic_search.svg" alt="" class="nav-ic" />
            <span>Search</span>
            <kbd class="shortcut-kbd">⌘K</kbd>
          </a>
        </nav>

        <!-- Sidebar Inventory & Wishlist Summary Box -->
        <div class="sidebar-stats studio-card">
          <div class="stat-line">
            <span>Inventory Owned</span>
            <strong class="owned-txt">{{ userState.state().inventoryPaintIds.length }}</strong>
          </div>
          <div class="stat-line">
            <span>Wishlist</span>
            <strong class="wish-txt">{{ userState.state().wishlistPaintIds.length }}</strong>
          </div>
          <div class="stat-line">
            <span>3rd-Party Brands</span>
            <strong>{{ catalog.thirdPartyBrands().length }}</strong>
          </div>
          <div class="stat-line">
            <span>Catalog Cache</span>
            <span class="cache-dot" [attr.data-status]="catalog.syncStatus()">
              ● {{ catalog.syncStatus() }}
            </span>
          </div>
        </div>
      </aside>

      <!-- Main Viewport -->
      <main class="main-viewport">
        @if (catalog.loading() && catalog.models().length === 0) {
          <div class="boot-loader">
            <img src="/icons/ic_hobby_desk.svg" alt="" class="pulse-ic" />
            <h2>Hydrating Citadel Colour Catalog...</h2>
            <p>Loading 4,531 Model Guides, 596 Colours, 487 Citadel Paints & 145 Cross-Brand Equivalents</p>
          </div>
        } @else {
          <router-outlet></router-outlet>
        }
      </main>

      <!-- Mobile Bottom 4-Tab Bar (Mirrors Android App) -->
      <nav class="mobile-bottom-nav">
        <a routerLink="/hobby-desk" routerLinkActive="active" class="mob-tab">
          <img src="/icons/ic_hobby_desk.svg" alt="" />
          <span>Hobby Desk</span>
        </a>
        <a routerLink="/models" routerLinkActive="active" class="mob-tab">
          <img src="/icons/ic_models.svg" alt="" />
          <span>Paint Model</span>
        </a>
        <a routerLink="/colours" routerLinkActive="active" class="mob-tab">
          <img src="/icons/ic_colour.svg" alt="" />
          <span>Paint Colour</span>
        </a>
        <a routerLink="/search" routerLinkActive="active" class="mob-tab">
          <img src="/icons/ic_search.svg" alt="" />
          <span>Search</span>
        </a>
      </nav>

      <!-- Global Paint Detail Modal -->
      <app-paint-detail-modal></app-paint-detail-modal>

      <!-- Toast Notification -->
      @if (userState.toastMessage(); as msg) {
        <div class="toast-banner">
          <span>{{ msg }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .app-shell {
        display: flex;
        min-height: 100vh;
        background: var(--bg-primary);
      }
      .sidebar {
        width: 260px;
        background: var(--bg-void);
        border-right: 1px solid var(--border-subtle);
        display: flex;
        flex-direction: column;
        padding: 20px 16px;
        position: sticky;
        top: 0;
        height: 100vh;
        flex-shrink: 0;
      }
      .brand-box {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 10px 20px;
        border-bottom: 1px solid var(--border-subtle);
        cursor: pointer;
      }
      .brand-crest {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: var(--bg-card);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
        border: 1px solid var(--gold-border);
      }
      .crest-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .brand-titles {
        display: flex;
        flex-direction: column;
      }
      .brand-main {
        font-family: var(--font-display);
        font-size: 1.25rem;
        letter-spacing: 0.06em;
        color: var(--gold-bright);
        line-height: 1.1;
      }
      .brand-sub {
        font-family: var(--font-sans);
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .side-nav {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 20px;
        flex: 1;
      }
      .nav-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 11px 14px;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.15s ease;
        border: 1px solid transparent;
      }
      .nav-link:hover {
        background: var(--bg-elevated);
        color: var(--text-primary);
      }
      .nav-link.active {
        background: var(--gold-soft);
        color: var(--gold-bright);
        border-color: var(--gold-border);
      }
      .nav-ic {
        width: 20px;
        height: 20px;
      }
      .nav-count {
        margin-left: auto;
        font-size: 0.72rem;
        padding: 2px 7px;
        border-radius: var(--radius-pill);
        background: var(--gold-soft);
        color: var(--gold-bright);
      }
      .nav-count.muted {
        background: rgba(255, 255, 255, 0.06);
        color: var(--text-muted);
      }
      .shortcut-kbd {
        margin-left: auto;
        font-family: monospace;
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--text-muted);
      }
      .sidebar-stats {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-secondary);
      }
      .stat-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .owned-txt {
        color: var(--status-owned);
      }
      .wish-txt {
        color: var(--status-wishlist);
      }
      .cache-dot {
        font-size: 0.72rem;
        color: var(--status-owned);
        text-transform: uppercase;
        font-weight: 700;
      }
      .main-viewport {
        flex: 1;
        min-width: 0;
        padding: 24px 28px 60px;
        max-width: 1560px;
        margin: 0 auto;
        width: 100%;
      }
      .boot-loader {
        height: 70vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 12px;
      }
      .pulse-ic {
        width: 56px;
        height: 56px;
      }
      .boot-loader p {
        font-family: var(--font-sans);
        color: var(--text-secondary);
      }
      .mobile-bottom-nav {
        display: none;
      }
      @media (max-width: 860px) {
        .sidebar {
          display: none;
        }
        .main-viewport {
          padding: 16px 14px 86px;
        }
        .mobile-bottom-nav {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 66px;
          background: rgba(13, 14, 17, 0.96);
          backdrop-filter: blur(10px);
          border-top: 1px solid var(--border-strong);
          z-index: 900;
        }
        .mob-tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-size: 0.7rem;
          font-weight: 600;
        }
        .mob-tab img {
          width: 22px;
          height: 22px;
        }
        .mob-tab.active {
          color: var(--gold-bright);
        }
      }
      .toast-banner {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 1200;
        background: var(--bg-void);
        border: 1px solid var(--gold-bright);
        color: var(--gold-bright);
        padding: 12px 18px;
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-modal);
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 0.86rem;
      }
    `,
  ],
})
export class AppComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  private readonly router = inject(Router);

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.router.navigate(['/search']);
    }
  }
}
