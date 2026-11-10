import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { ThemeService } from './theme.service';
echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

@Component({ selector:'app-chart', standalone:true, template:'<div #chart class="chart" role="img" [attr.aria-label]="label"></div>', styles:[':host{display:block;min-width:0}.chart{width:100%;height:100%;min-height:270px}'] })
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  private theme=inject(ThemeService);
  @Input() option: EChartsCoreOption = {};
  @Input() label = 'Gráfico de cartera';
  @ViewChild('chart') element!: ElementRef<HTMLDivElement>;
  private chart?: echarts.ECharts;
  private observer?: ResizeObserver;
  constructor(){effect(()=>{this.theme.resolved();this.render();});}
  ngAfterViewInit() { this.chart=echarts.init(this.element.nativeElement,undefined,{renderer:'svg'}); this.render(); this.observer=new ResizeObserver(()=>this.chart?.resize()); this.observer.observe(this.element.nativeElement); }
  ngOnChanges() { this.render(); }
  private render() { const c=this.theme.colors(),raw=this.option['tooltip'];const tooltip=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};this.chart?.setOption({animation:false,backgroundColor:'transparent',textStyle:{color:c.text},...this.option,tooltip:{...tooltip,backgroundColor:c.surface,borderColor:c.line,textStyle:{color:c.text}}},true); }
  ngOnDestroy() { this.observer?.disconnect(); this.chart?.dispose(); }
}
